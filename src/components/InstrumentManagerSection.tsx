import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Edit3,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import {
  INSTRUMENT_CATEGORIES,
  InstrumentCategory,
  InstrumentDefinition,
  JournalEntry,
  LiveWorkspaceData,
  SavedReport,
  SavedTemplate,
} from '../types/journal';
import {
  addCustomInstrument,
  archiveInstrument,
  getVerifiedFeedForInstrument,
  moveInstrumentOrder,
  removeOrArchiveInstrument,
  restoreDefaultInstruments,
  sortInstruments,
  toggleInstrumentEnabled,
  unarchiveInstrument,
  updateInstrumentDefinition,
} from '../services/instruments';
import {
  getAllJournalEntries,
  getAllLiveWorkspaces,
  getAllReports,
  getAllTemplates,
} from '../services/db';

interface InstrumentManagerSectionProps {
  instruments: InstrumentDefinition[];
  onChangeInstruments: (nextList: InstrumentDefinition[]) => void;
}

interface FormState {
  symbol: string;
  displayName: string;
  category: InstrumentCategory;
  exchangeOrBroker: string;
  quoteCurrency: string;
  precision: string;
}

const EMPTY_FORM: FormState = {
  symbol: '',
  displayName: '',
  category: 'Forex',
  exchangeOrBroker: '',
  quoteCurrency: '',
  precision: '',
};

export const InstrumentManagerSection: React.FC<InstrumentManagerSectionProps> = ({
  instruments,
  onChangeInstruments,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [historyContext, setHistoryContext] = useState<{
    reports: SavedReport[];
    templates: SavedTemplate[];
    journalEntries: JournalEntry[];
    liveWorkspaces: LiveWorkspaceData[];
  }>({
    reports: [],
    templates: [],
    journalEntries: [],
    liveWorkspaces: [],
  });

  useEffect(() => {
    Promise.all([
      getAllReports().catch(() => []),
      getAllTemplates().catch(() => []),
      getAllJournalEntries().catch(() => []),
      getAllLiveWorkspaces().catch(() => []),
    ]).then(([reports, templates, journalEntries, liveWorkspaces]) => {
      setHistoryContext({ reports, templates, journalEntries, liveWorkspaces });
    });
  }, []);

  const sorted = useMemo(() => sortInstruments(instruments), [instruments]);
  const activeInstruments = useMemo(() => sorted.filter((i) => !i.archived), [sorted]);
  const archivedInstruments = useMemo(() => sorted.filter((i) => i.archived), [sorted]);
  const enabledCount = useMemo(
    () => activeInstruments.filter((i) => i.enabled).length,
    [activeInstruments]
  );

  const editingTarget = useMemo(
    () => (editingId ? sorted.find((i) => i.id === editingId) || null : null),
    [editingId, sorted]
  );

  const openAddForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (inst: InstrumentDefinition) => {
    setEditingId(inst.id);
    setForm({
      symbol: inst.symbol,
      displayName: inst.displayName,
      category: inst.category,
      exchangeOrBroker: inst.exchangeOrBroker || '',
      quoteCurrency: inst.quoteCurrency || '',
      precision: inst.precision !== undefined ? String(inst.precision) : '',
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusNotice(null);

    if (editingId) {
      const res = updateInstrumentDefinition(instruments, editingId, {
        symbol: form.symbol,
        displayName: form.displayName,
        category: form.category,
        exchangeOrBroker: form.exchangeOrBroker,
        quoteCurrency: form.quoteCurrency,
        precision: form.precision,
      });
      if (res.error || !res.updated) {
        setFormError(res.error || 'Could not update instrument.');
        return;
      }
      onChangeInstruments(res.list);
      setIsFormOpen(false);
      setEditingId(null);
      setStatusNotice(`Updated ${res.updated.symbol}.`);
    } else {
      const res = addCustomInstrument(instruments, {
        symbol: form.symbol,
        displayName: form.displayName,
        category: form.category,
        exchangeOrBroker: form.exchangeOrBroker,
        quoteCurrency: form.quoteCurrency,
        precision: form.precision,
      });
      if (res.error || !res.added) {
        setFormError(res.error || 'Could not add instrument.');
        return;
      }
      onChangeInstruments(res.list);
      setIsFormOpen(false);
      setForm(EMPTY_FORM);
      setStatusNotice(`Added ${res.added.symbol} (${res.added.displayName}) — manual observation & analysis ready.`);
    }
  };

  const handleDeleteOrArchive = (inst: InstrumentDefinition) => {
    setStatusNotice(null);
    const res = removeOrArchiveInstrument(instruments, inst.id, historyContext);
    onChangeInstruments(res.list);
    if (res.reason) {
      setStatusNotice(res.reason);
    } else if (res.action === 'deleted') {
      setStatusNotice(`Removed unreferenced instrument ${inst.symbol}.`);
    }
  };

  const handleRestoreDefaults = () => {
    setStatusNotice(null);
    const restored = restoreDefaultInstruments(instruments);
    onChangeInstruments(restored);
    setStatusNotice('Default instruments (XAUUSD, EURUSD, BTCUSD) restored without affecting custom instruments or historical records.');
  };

  return (
    <div className="space-y-4">
      {/* Header & Summary */}
      <div className="p-3 rounded-md bg-app-secondary/50 border border-app space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-app-main flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-emerald-theme" />
            <span>Instruments Registry</span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-app-secondary">
            {enabledCount} enabled · {activeInstruments.length} active · {archivedInstruments.length} archived
          </span>
        </div>
        <p className="text-[11px] text-app-secondary leading-relaxed">
          Manage instruments shown across Analysis, Journal, Live Workspace, Reports, and Performance. Custom symbols support full analysis, journaling, and manual Live price tracking unless a verified feed is connected.
        </p>
      </div>

      {/* Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={openAddForm}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Instrument</span>
        </button>

        <button
          type="button"
          onClick={handleRestoreDefaults}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main bg-app-field border border-app rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title="Re-enables XAUUSD, EURUSD, and BTCUSD without deleting custom instruments"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Restore Default Instruments</span>
        </button>
      </div>

      {statusNotice && (
        <div className="p-2.5 rounded border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:opacity-75 cursor-pointer"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Add / Edit Form */}
      {isFormOpen && (
        <form
          onSubmit={handleSubmitForm}
          className="p-3.5 rounded-lg border border-emerald-500/40 bg-app-secondary/40 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-app pb-2">
            <span className="text-xs font-bold text-app-main">
              {editingId ? `Edit ${editingTarget?.symbol || 'Instrument'}` : 'Add Custom Instrument'}
            </span>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setEditingId(null);
                setFormError(null);
              }}
              className="p-1 text-app-secondary hover:text-app-main cursor-pointer"
              aria-label="Close instrument form"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                Symbol *
              </label>
              <input
                type="text"
                value={form.symbol}
                disabled={Boolean(editingTarget?.isDefault)}
                onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                placeholder="e.g. GBPUSD, NAS100, AAPL"
                className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main font-mono uppercase disabled:opacity-60"
              />
              {editingTarget?.isDefault && (
                <span className="text-[10px] text-app-secondary block mt-0.5">
                  Default symbol ID is fixed; display name and precision can be updated.
                </span>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                Category *
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as InstrumentCategory }))}
                className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main cursor-pointer"
              >
                {INSTRUMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                Display Name *
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="e.g. British Pound / US Dollar, Nasdaq 100"
                className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                Exchange / Broker (Optional)
              </label>
              <input
                type="text"
                value={form.exchangeOrBroker}
                onChange={(e) => setForm((f) => ({ ...f, exchangeOrBroker: e.target.value }))}
                placeholder="e.g. NASDAQ, Exness, OANDA"
                className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                  Quote Currency
                </label>
                <input
                  type="text"
                  value={form.quoteCurrency}
                  onChange={(e) => setForm((f) => ({ ...f, quoteCurrency: e.target.value }))}
                  placeholder="USD"
                  className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main uppercase"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-app-secondary mb-1">
                  Precision (0–8)
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={form.precision}
                  onChange={(e) => setForm((f) => ({ ...f, precision: e.target.value }))}
                  placeholder="2"
                  className="w-full px-2.5 py-1.5 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          {formError && (
            <div className="p-2 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                setEditingId(null);
                setFormError(null);
              }}
              className="px-3 py-1.5 text-xs text-app-secondary hover:text-app-main bg-app-field border border-app rounded cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{editingId ? 'Save Changes' : 'Save Instrument'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Active Instruments List */}
      <div className="divide-y divide-app border border-app rounded-lg bg-app-main overflow-hidden">
        {activeInstruments.map((inst, index) => {
          const feed = getVerifiedFeedForInstrument(inst);
          return (
            <div
              key={inst.id}
              className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                inst.enabled ? '' : 'opacity-70 bg-app-field/40'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs sm:text-sm text-app-main">
                    {inst.symbol}
                  </span>
                  <span className="text-xs text-app-main truncate">{inst.displayName}</span>
                </div>
                <div className="text-[11px] text-app-secondary flex flex-wrap items-center gap-1.5">
                  <span>{inst.category}</span>
                  {inst.exchangeOrBroker && (
                    <>
                      <span>·</span>
                      <span>{inst.exchangeOrBroker}</span>
                    </>
                  )}
                  {inst.quoteCurrency && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{inst.quoteCurrency}</span>
                    </>
                  )}
                  {inst.precision !== undefined && (
                    <>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{inst.precision}dp</span>
                    </>
                  )}
                  <span>·</span>
                  <span className={feed.supported ? 'text-emerald-theme font-medium' : ''}>
                    {feed.providerLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => onChangeInstruments(moveInstrumentOrder(instruments, inst.id, 'up'))}
                  disabled={index === 0}
                  className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded disabled:opacity-30 cursor-pointer"
                  aria-label={`Move ${inst.symbol} up`}
                  title="Move up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChangeInstruments(moveInstrumentOrder(instruments, inst.id, 'down'))}
                  disabled={index === activeInstruments.length - 1}
                  className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded disabled:opacity-30 cursor-pointer"
                  aria-label={`Move ${inst.symbol} down`}
                  title="Move down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onChangeInstruments(toggleInstrumentEnabled(instruments, inst.id))}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                    inst.enabled
                      ? 'bg-emerald-theme text-white border-emerald-600'
                      : 'bg-app-field text-app-secondary border-app hover:text-app-main'
                  }`}
                  aria-pressed={inst.enabled}
                >
                  {inst.enabled ? 'Enabled' : 'Disabled'}
                </button>

                <button
                  type="button"
                  onClick={() => openEditForm(inst)}
                  className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded cursor-pointer"
                  aria-label={`Edit ${inst.symbol}`}
                  title="Edit details"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteOrArchive(inst)}
                  className="p-1.5 text-app-secondary hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer"
                  aria-label={`Archive or remove ${inst.symbol}`}
                  title={inst.isDefault ? 'Archive default instrument' : 'Archive or remove'}
                >
                  {inst.isDefault ? <Archive className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Archived Instruments Collapsible Section */}
      {archivedInstruments.length > 0 && (
        <div className="border border-app rounded-lg overflow-hidden bg-app-secondary/30">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-app-secondary hover:text-app-main cursor-pointer"
          >
            <span>Archived Instruments ({archivedInstruments.length})</span>
            <span>{showArchived ? 'Hide' : 'Show'}</span>
          </button>
          {showArchived && (
            <div className="divide-y divide-app border-t border-app bg-app-main">
              {archivedInstruments.map((inst) => (
                <div key={inst.id} className="p-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-app-main">{inst.symbol}</span>
                    <span className="text-app-secondary ml-2">{inst.displayName}</span>
                    <span className="text-[11px] text-app-secondary block">
                      {inst.category}
                      {inst.exchangeOrBroker ? ` · ${inst.exchangeOrBroker}` : ''} · Historical records preserved
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChangeInstruments(unarchiveInstrument(instruments, inst.id))}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-app-field border border-app rounded text-emerald-theme hover:bg-emerald-pale cursor-pointer shrink-0"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
