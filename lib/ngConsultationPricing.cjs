const NIGERIA_CONSULTATION_PRICES = Object.freeze({
  general: {
    code: 'general',
    label: 'General consultation',
    amount: 7500,
  },
  specialist: {
    code: 'specialist',
    label: 'Specialist consultation',
    amount: 20000,
  },
  followUp: {
    code: 'follow_up',
    label: 'Follow-up review',
    amount: 5000,
  },
});

const NIGERIA_CONSULTATION_CURRENCY = Object.freeze({
  code: 'NGN',
  symbol: '\u20a6',
});

function formatNairaAmount(amount) {
  return `${NIGERIA_CONSULTATION_CURRENCY.symbol}${Number(amount || 0).toLocaleString('en-NG')}`;
}

function getNigeriaConsultationPriceList() {
  return Object.values(NIGERIA_CONSULTATION_PRICES).map((item) => ({
    ...item,
    currency: NIGERIA_CONSULTATION_CURRENCY.code,
    displayPrice: formatNairaAmount(item.amount),
    priceLabel: `${item.label}: ${formatNairaAmount(item.amount)}`,
  }));
}

function getNigeriaConsultationPriceFeatures() {
  return getNigeriaConsultationPriceList().map((item) => item.priceLabel);
}

module.exports = {
  NIGERIA_CONSULTATION_CURRENCY,
  NIGERIA_CONSULTATION_PRICES,
  formatNairaAmount,
  getNigeriaConsultationPriceFeatures,
  getNigeriaConsultationPriceList,
};
