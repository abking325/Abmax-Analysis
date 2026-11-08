#!/usr/bin/env bash
# ==============================================================================
# ABMAX ANALYSIS — PERMANENT RELEASE SIGNING KEY GENERATOR
# ==============================================================================
# This script generates a permanent, cryptographically secure PKCS12 release keystore
# for AbMax Analysis and encodes it as Base64 for your GitHub Actions secret.
#
# Usage:
#   chmod +x scripts/generate-signing-keystore.sh
#   ./scripts/generate-signing-keystore.sh
#
# Requirements:
#   - Java keytool (available with any standard JDK or Android Studio)
#   - base64 utility
# ==============================================================================

set -euo pipefail

KEYSTORE_FILE="abmax-release.keystore"
KEY_ALIAS="abmax"
OUTPUT_BASE64_FILE="keystore_base64.txt"

echo "=========================================================="
echo "ABMAX ANALYSIS - Permanent Release Keystore Generator"
echo "=========================================================="

if [ -f "$KEYSTORE_FILE" ]; then
  echo "⚠️ An existing $KEYSTORE_FILE already exists in this folder."
  read -rp "Do you want to overwrite it and create a NEW permanent key? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted. Keeping existing $KEYSTORE_FILE."
    exit 0
  fi
  rm -f "$KEYSTORE_FILE" "$OUTPUT_BASE64_FILE"
fi

echo ""
echo "Please enter a strong password for your permanent signing key."
echo "(Remember to keep this password safe in your password manager!)"
echo ""
read -rsp "Enter Keystore Password (min 8 chars): " STORE_PASS
echo ""
read -rsp "Confirm Keystore Password: " STORE_PASS_CONFIRM
echo ""

if [ "$STORE_PASS" != "$STORE_PASS_CONFIRM" ]; then
  echo "❌ Passwords do not match! Aborted."
  exit 1
fi

if [ ${#STORE_PASS} -lt 8 ]; then
  echo "❌ Password must be at least 8 characters long! Aborted."
  exit 1
fi

echo ""
echo "Generating permanent 2048-bit RSA release keystore ($KEYSTORE_FILE)..."

keytool -genkeypair \
  -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype PKCS12 \
  -storepass "$STORE_PASS" \
  -keypass "$STORE_PASS" \
  -dname "CN=AbMax Analysis, OU=Mobile Production, O=AbMax, L=Global, ST=Global, C=US"

echo "✅ Keystore created successfully."

# Extract and display the SHA-256 fingerprint for verification
SHA256_FINGERPRINT=$(keytool -list -v -keystore "$KEYSTORE_FILE" -storepass "$STORE_PASS" -alias "$KEY_ALIAS" 2>/dev/null | grep -i "SHA256:" | head -n 1 | awk '{print $2}')

echo ""
echo "=========================================================="
echo "KEYSTORE CREATION SUCCESSFUL"
echo "=========================================================="
echo "Keystore File:       $KEYSTORE_FILE"
echo "Key Alias:           $KEY_ALIAS"
echo "Validity:            10,000 days (~27 years)"
echo "Certificate SHA-256: $SHA256_FINGERPRINT"
echo "=========================================================="

# Base64 encode for GitHub Actions secret
if command -v base64 >/dev/null 2>&1; then
  if base64 --help 2>&1 | grep -q -- "-w"; then
    base64 -w 0 "$KEYSTORE_FILE" > "$OUTPUT_BASE64_FILE"
  else
    # macOS base64
    base64 -i "$KEYSTORE_FILE" -o "$OUTPUT_BASE64_FILE"
  fi
  echo ""
  echo "✅ Base64 encoded file generated: $OUTPUT_BASE64_FILE"
  echo ""
  echo "Next Steps to complete GitHub Actions setup:"
  echo "1. Go to your GitHub Repository -> Settings -> Secrets and variables -> Actions"
  echo "2. Add the following repository secrets:"
  echo "   - KEYSTORE_BASE64   : Copy and paste the entire contents of '$OUTPUT_BASE64_FILE'"
  echo "   - KEYSTORE_PASSWORD : The password you entered above"
  echo "   - KEY_ALIAS         : $KEY_ALIAS"
  echo "   - KEY_PASSWORD     : The password you entered above"
  echo ""
  echo "3. ⚠️ IMPORTANT: BACK UP '$KEYSTORE_FILE' TO A SAFE LOCATION (e.g. Google Drive)!"
  echo "   Do NOT lose this file. It is required to publish future updates to your installed app."
fi
