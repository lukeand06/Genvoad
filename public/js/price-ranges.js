// Price range definitions for projects and bids
const PRICE_RANGES = {
  small: {
    label: 'Small',
    min: 0,
    max: 5000,
    description: 'Quick projects, minor updates, simple tasks',
    examples: 'Logo design, website fixes, basic consulting (1-2 weeks)'
  },
  medium: {
    label: 'Medium',
    min: 5000,
    max: 25000,
    description: 'Standard projects with moderate complexity',
    examples: 'Website development, branding packages, small app features (1-2 months)'
  },
  'upper-medium': {
    label: 'Upper Medium',
    min: 25000,
    max: 100000,
    description: 'Complex projects requiring significant resources',
    examples: 'Full web applications, comprehensive marketing campaigns, major integrations (2-6 months)'
  },
  large: {
    label: 'Large',
    min: 100000,
    max: null,
    description: 'Enterprise-level projects with extensive scope',
    examples: 'Platform development, complete digital transformation, large-scale systems (6+ months)'
  }
};

function getPriceRangeLabel(range) {
  return PRICE_RANGES[range]?.label || 'Custom';
}

function getPriceRangeDescription(range) {
  return PRICE_RANGES[range]?.description || '';
}

function formatPriceRange(range) {
  const r = PRICE_RANGES[range];
  if (!r) return 'Custom';
  
  if (r.max === null) {
    return `${formatCurrency(r.min)}+`;
  }
  return `${formatCurrency(r.min)} - ${formatCurrency(r.max)}`;
}

function getBidDisplay(bid) {
  // If exact amount is provided and priceRange is 'exact' or not set
  if (bid.amount && (!bid.priceRange || bid.priceRange === 'exact')) {
    return formatCurrency(bid.amount);
  }
  
  // If range is provided
  if (bid.priceRange && bid.priceRange !== 'exact') {
    return formatPriceRange(bid.priceRange);
  }
  
  // Fallback
  return bid.amount ? formatCurrency(bid.amount) : 'Range not specified';
}

function getProjectBudgetDisplay(project) {
  // If budget is public, show exact amount
  if (project.budgetPublic) {
    return formatCurrency(project.budget);
  }
  
  // If project size is set, show range
  if (project.projectSize && project.projectSize !== 'custom') {
    return formatPriceRange(project.projectSize);
  }
  
  // If target price is set, show that
  if (project.targetPrice) {
    return `Target: ${formatCurrency(project.targetPrice)}`;
  }
  
  // Default to anonymous
  return 'Budget not disclosed';
}
