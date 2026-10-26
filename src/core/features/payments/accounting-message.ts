type AccountingMessage = { sentence: string; reconnect?: boolean; blockExport?: boolean };

const messages: Record<string, AccountingMessage> = {
  accounting_not_configured: { sentence: 'Set up the QuickBooks connection in your deployment settings.', blockExport: true },
  accounting_outcome_unknown: { sentence: 'Check QuickBooks for the payment before trying again.' },
  accounting_authorization_refused: { sentence: 'Reconnect QuickBooks Online to allow accounting access.', reconnect: true },
  accounting_invalid_token_response: { sentence: 'QuickBooks could not complete the connection; try connecting again.', reconnect: true },
  accounting_refresh_in_progress: { sentence: 'Wait for the QuickBooks connection to finish updating, then try again.' },
  accounting_reconnect_required: { sentence: 'Reconnect QuickBooks Online to resume exports.', reconnect: true },
  accounting_token_refused: { sentence: 'For a development-key connection, set QBO_ENVIRONMENT=sandbox in your deployment settings; otherwise reconnect QuickBooks Online.', blockExport: true },
  accounting_provider_refused: { sentence: 'Check your QuickBooks permissions before trying again.', blockExport: true },
  income_account_not_found: { sentence: 'Choose an existing income account in QuickBooks.', blockExport: true },
  income_account_required: { sentence: 'Choose an income account before exporting payments.', blockExport: true },
  accounting_item_missing: { sentence: 'Choose the income account again to create the QuickBooks sales item.', blockExport: true },
  accounting_custom_transaction_numbers_required: { sentence: 'Turn on custom transaction numbers in QuickBooks, then export again.', blockExport: true },
  accounting_usd_company_required: { sentence: 'Your QuickBooks company must use US dollars.', blockExport: true },
  accounting_tax_mapping_required: { sentence: 'Payments with sales tax cannot be exported until Dial supports QuickBooks tax mapping.', blockExport: true },
  accounting_recovery_mismatch: { sentence: 'Check the matching receipt in QuickBooks before exporting again.', blockExport: true },
  accounting_receipt_missing: { sentence: 'Check QuickBooks for the receipt before trying again.', blockExport: true },
  invalid_accounting_oauth_state: { sentence: 'Connect QuickBooks Online again to verify the connection.', reconnect: true },
  reauthorization_required: { sentence: 'Reconnect QuickBooks Online after restoring your data.', reconnect: true },
};

/** Provider codes stay at the API boundary; unknown failures never display raw messages. */
export function accountingMessage(code: string | null | undefined): AccountingMessage {
  return code && Object.hasOwn(messages, code) ? messages[code]! : { sentence: 'Accounting could not finish. Try again.', blockExport: true };
}

export async function accountingErrorCode(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => undefined);
  if (value && typeof value === 'object' && 'error' in value) {
    const error = value.error;
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  }
  return '';
}
