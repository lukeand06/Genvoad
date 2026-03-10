// Authentication utilities
// Force HTTPS in production to prevent mixed content errors

// Enforce HTTPS for all API requests in production
const SAFE_ORIGIN = (() => {
  const { hostname, origin, protocol } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  
  if (isLocal) {
    return origin;
  }
  
  // Production: Always use canonical HTTPS origin
  // This prevents any http:// or non-www variants from being used
  if (hostname && hostname.includes('genovad.com')) {
    return 'https://www.genovad.com';
  }
  
  // Fallback for any other environment
  return protocol === 'https:' ? origin : origin.replace('http://', 'https://');
})();

const API_URL = `${SAFE_ORIGIN}/api`;

// Aggressive HTTP to HTTPS rewriter for any URL
function forceHTTPS(url) {
  if (!url) return url;
  // Force any genovad.com URL to HTTPS with www
  return url
    .replace(/^http:\/\/(www\.)?genovad\.com/gi, 'https://www.genovad.com')
    .replace(/^https:\/\/genovad\.com/gi, 'https://www.genovad.com');
}

// Remap URLs that may be blocked by privacy/ad blockers
function getBlockerSafeUrl(fullUrl) {
  try {
    const parsed = new URL(fullUrl, window.location.origin);
    let path = parsed.pathname;

    if (path.startsWith('/api/messages/conversations')) {
      path = path.replace('/api/messages/conversations', '/x/convos');
    } else if (path.startsWith('/api/notifications')) {
      path = path.replace('/api/notifications', '/x/updates');
    } else if (path.startsWith('/api/feed')) {
      path = path.replace('/api/feed', '/x/feed');
    } else if (path.startsWith('/api/projects')) {
      path = path.replace('/api/projects', '/x/projects');
    } else {
      return null;
    }

    parsed.pathname = path;
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

// Get token from localStorage
function getToken() {
  return localStorage.getItem('token');
}

function setActivePlatform(platform) {
  const normalized = platform === 'communities' ? 'communities' : 'genovad';
  localStorage.setItem('activePlatform', normalized);
}

function getActivePlatform() {
  const platform = localStorage.getItem('activePlatform');
  return platform === 'communities' ? 'communities' : 'genovad';
}

function getLoginRoute(platform = null) {
  const target = platform || getActivePlatform();
  return target === 'communities' ? '/communities-login.html' : '/login.html';
}

// Set token in localStorage
function setToken(token) {
  localStorage.setItem('token', token);
}

// Remove token
function logout() {
  const platform = getActivePlatform();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = getLoginRoute(platform);
}

// Get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Get current user ID (handles both _id and id)
function getUserId() {
  const user = getCurrentUser();
  return user?._id || user?.id;
}

// Save current user
function setCurrentUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

// Get user role (owner or vendor)
function getUserRole() {
  const user = getCurrentUser();
  return user?.role || 'owner';
}

// Set active role (for role switching)
function setActiveRole(role) {
  if (role && ['owner', 'vendor'].includes(role)) {
    localStorage.setItem('activeRole', role);
  }
}

// Get active role
function getActiveRole() {
  return localStorage.getItem('activeRole') || getUserRole() || 'owner';
}

// Check if authenticated
function isAuthenticated() {
  return !!getToken();
}

// Redirect if not authenticated
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = getLoginRoute();
    return false;
  }
  return true;
}

function requirePlatform(expectedPlatform, redirectPath = null) {
  const expected = expectedPlatform === 'communities' ? 'communities' : 'genovad';

  if (!isAuthenticated()) {
    window.location.href = getLoginRoute(expected);
    return false;
  }

  const current = getActivePlatform();
  if (current !== expected) {
    if (redirectPath) {
      window.location.href = redirectPath;
      return false;
    }

    window.location.href = current === 'communities' ? '/community-hub.html' : '/dashboard.html';
    return false;
  }

  return true;
}

function updateNotificationBadges(unreadCount) {
  const badges = document.querySelectorAll('[id="notification-badge"], [id="nav-notification-badge"]');
  if (!badges.length) return;

  badges.forEach((badge) => {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

async function refreshNotificationBadge() {
  if (!isAuthenticated()) return;

  const badges = document.querySelectorAll('[id="notification-badge"], [id="nav-notification-badge"]');
  if (!badges.length) return;

  try {
    const res = await authFetch('/api/notifications?limit=1');
    if (!res.ok) return;
    const data = await res.json();
    const unreadCount = Number.isFinite(data.unreadCount) ? data.unreadCount : 0;
    updateNotificationBadges(unreadCount);
  } catch (error) {
    console.error('Failed to refresh notification badge:', error);
  }
}

function initNotificationBadge() {
  const run = () => refreshNotificationBadge();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}

initNotificationBadge();

// Redirect if authenticated (for login/signup pages)
function getPostAuthRoute(user = null, platform = null) {
  const profile = user || getCurrentUser();
  if (profile && !profile.onboardingCompleted) {
    return '/onboarding-profile.html';
  }
  const activePlatform = platform || getActivePlatform();
  if (activePlatform === 'communities') {
    return '/community-hub.html';
  }
  return '/dashboard.html';
}

function getPrimaryCommunityId(user = null) {
  const profile = user || getCurrentUser();
  if (!profile) return null;

  if (profile.activeCommunityId) return profile.activeCommunityId;
  if (profile.companyId) return profile.companyId;
  if (Array.isArray(profile.communityIds) && profile.communityIds.length > 0) {
    return profile.communityIds[0];
  }
  return null;
}

function hasJoinedCommunity(user = null) {
  return !!getPrimaryCommunityId(user);
}

function requireCommunityMembership(redirectTo = '/community-hub.html') {
  const profile = getCurrentUser();
  if (!profile) {
    window.location.href = getLoginRoute('communities');
    return false;
  }

  if (!profile.onboardingCompleted) {
    window.location.href = '/onboarding-profile.html';
    return false;
  }

  if (!hasJoinedCommunity(profile)) {
    window.location.href = `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}join-required=true`;
    return false;
  }

  return true;
}

function redirectIfAuth() {
  if (isAuthenticated()) {
    window.location.href = getPostAuthRoute();
    return true;
  }
  return false;
}

// API helper with auth
async function authFetch(url, options = {}) {
  const token = getToken();
  
  // Don't set Content-Type for FormData (let browser set it with boundary)
  const headers = options.body instanceof FormData 
    ? { ...options.headers }
    : {
        'Content-Type': 'application/json',
        ...options.headers
      };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  // Build full URL robustly to avoid double "/api"
  let fullUrl = '';
  if (/^https?:\/\//i.test(url)) {
    fullUrl = forceHTTPS(url);
  } else if (url.startsWith('/api/')) {
    fullUrl = `${SAFE_ORIGIN}${url}`;
  } else if (url.startsWith('/')) {
    fullUrl = `${SAFE_ORIGIN}${url}`;
  } else {
    fullUrl = `${API_URL}${url}`;
  }
  
  // Final aggressive HTTPS enforcement
  fullUrl = forceHTTPS(fullUrl);

  let response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      headers
    });
  } catch (error) {
    const method = (options.method || 'GET').toUpperCase();
    const fallbackUrl = method === 'GET' ? getBlockerSafeUrl(fullUrl) : null;

    if (fallbackUrl && fallbackUrl !== fullUrl) {
      response = await fetch(fallbackUrl, {
        ...options,
        headers
      });
    } else {
      throw error;
    }
  }
  
  if (response.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  
  return response;
}

// Show error message
function showError(message, elementId = 'error-message') {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 5000);
  }
}

// Show success message
function showSuccess(message, elementId = 'success-message') {
  const successDiv = document.getElementById(elementId);
  if (successDiv) {
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    setTimeout(() => successDiv.classList.add('hidden'), 5000);
  }
}

// Clear error message
function clearError(elementId = 'error-message') {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
  }
}

// Clear success message
function clearSuccess(elementId = 'success-message') {
  const successDiv = document.getElementById(elementId);
  if (successDiv) {
    successDiv.classList.add('hidden');
    successDiv.textContent = '';
  }
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return date.toLocaleDateString();
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0
  }).format(amount);
}

// Get initials from name
function getInitials(firstName, lastName) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// Generate avatar URL or initials
function getAvatarHTML(user, size = 'w-10 h-10') {
  if (user.avatar) {
    // Handle different avatar formats
    let avatarSrc = user.avatar;
    
    // If it's not a data URL and doesn't start with http//, prepend /uploads/
    if (!avatarSrc.startsWith('data:') && !avatarSrc.startsWith('http://') && !avatarSrc.startsWith('https://') && !avatarSrc.startsWith('/')) {
      avatarSrc = `/uploads/${avatarSrc}`;
    }
    
    const fallback = getInitials(user.firstName, user.lastName);
    const safeFallback = fallback.replace(/'/g, "\\'");
    return `<img src="${avatarSrc}" alt="${user.firstName || 'User'}" class="${size} rounded-full object-cover" onerror="this.onerror=null;this.innerHTML='<div class=&quot;${size} rounded-full bg-gray-700 text-white flex items-center justify-center font-medium&quot;>${safeFallback}</div>';this.parentNode.replaceChild(this.parentNode.lastChild, this);">`;
  }
  const initials = getInitials(user.firstName, user.lastName);
  return `<div class="${size} rounded-full bg-gray-700 text-white flex items-center justify-center font-medium">${initials}</div>`;
}

// Get verification badge HTML
function getVerificationBadge(user, size = 'small') {
  if (!user.registrarId) return '';
  
  const sizes = {
    small: 'w-4 h-4',
    medium: 'w-5 h-5',
    large: 'w-6 h-6'
  };
  
  const sizeClass = sizes[size] || sizes.small;
  
  return `<svg class="${sizeClass} text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" title="Verified Business">
    <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
  </svg>`;
}

// Get company verification badge HTML
function getCompanyVerificationBadge(company, size = 'small') {
  if (!company || !company.verified) return '';
  
  const badgeText = size === 'small' ? '✓' : '✓ Verified Company';
  const sizeClass = size === 'small' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  
  return `<span class="${sizeClass} bg-green-100 text-green-800 font-medium rounded-full" title="Verified Company">
    ${badgeText}
  </span>`;
}

// Get name with company first if available
function getDisplayName(user, includeVerification = false) {
  const verification = includeVerification ? getVerificationBadge(user, 'small') : '';
  
  if (user.company) {
    return `<span class="flex items-center gap-1.5">${user.company}${verification ? ` ${verification}` : ''}</span>`;
  }
  
  return `<span class="flex items-center gap-1.5">${user.firstName} ${user.lastName}${verification ? ` ${verification}` : ''}</span>`;
}

// Get secondary name (person name if company exists, empty otherwise)
function getSecondaryName(user) {
  if (user.company) {
    return `${user.firstName} ${user.lastName}`;
  }
  return user.title || '';
}
