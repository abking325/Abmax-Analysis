// Lightweight LIFO stack so Android hardware Back always dismisses ONLY the topmost open drawer/dialog.

type BackHandler = () => void;

const backStack: { id: symbol; handler: BackHandler }[] = [];

export function registerBackHandler(handler: BackHandler): () => void {
  const id = Symbol('backHandler');
  backStack.push({ id, handler });
  return () => {
    const idx = backStack.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      backStack.splice(idx, 1);
    }
  };
}

export function dispatchTopmostBackHandler(): boolean {
  if (backStack.length === 0) return false;
  const top = backStack[backStack.length - 1];
  try {
    top.handler();
  } catch (err) {
    console.warn('[BackNavigation] Handler threw error:', err);
  }
  return true;
}

export function getActiveBackHandlerCount(): number {
  return backStack.length;
}
