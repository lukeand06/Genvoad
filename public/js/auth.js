// Authentication utilities
const API_URL = `${window.location.origin}/api`;

// Get token from localStorage
function getToken() {
  return localStorage.getItem('token');
}

// Set token in localStorage
function setToken(token) {
  localStorage.setItem('token', token);
}

// Remove token
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
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

// Get active role
function getActiveRole() {
  const user = getCurrentUser();
  return user?.activeRole || user?.role || 'owner';
}

// Set active role in localStorage and user object
function setActiveRole(role) {
  const user = getCurrentUser();
  if (user) {
    user.activeRole = role;
    user.role = role;
    setCurrentUser(user);
  }
}

// Switch role on server and locally
async function switchRole(role) {
  try {
    const response = await authFetch('/api/auth/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role })
    });
    
    if (!response.ok) {
      const data = await response.json();
      
      // If user doesn't have this role, sign them out and redirect to login for that role
      if (response.status === 403) {
        alert(`You don't have a ${role} account. Signing you out - please log in to your ${role} account or create one.`);
        // Sign out first, then redirect to the appropriate login page
        logout();
        const loginPage = role === 'owner' ? '/owner-login.html' : '/vendor-login.html';
        window.location.href = loginPage;
        return;
      }
      
      throw new Error(data.error || 'Failed to switch role');
    }
    
    const data = await response.json();
    setCurrentUser(data.user);
    
    // Reload page or trigger role update event
    window.dispatchEvent(new CustomEvent('roleChanged', { detail: { role } }));
    
    return data.user;
  } catch (error) {
    console.error('Role switch error:', error);
    throw error;
  }
}

// Get available roles for current user
function getAvailableRoles() {
  const user = getCurrentUser();
  return user?.roles || [user?.role || 'owner'];
}

// Check if user has specific role
function hasRole(role) {
  const roles = getAvailableRoles();
  return roles.includes(role);
}

// Check if in specific role
function isActiveRole(role) {
  return getActiveRole() === role;
}

// Check if authenticated
function isAuthenticated() {
  return !!getToken();
}

// Redirect if not authenticated
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// Redirect if authenticated (for login/signup pages)
function redirectIfAuth() {
  if (isAuthenticated()) {
    window.location.href = '/dashboard.html';
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
    fullUrl = url;
  } else if (url.startsWith('/api/')) {
    fullUrl = `${window.location.origin}${url}`;
  } else if (url.startsWith('/')) {
    fullUrl = `${window.location.origin}${url}`;
  } else {
    fullUrl = `${API_URL}${url}`;
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers
  });
  
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
    const fallback = `${getInitials(user.firstName, user.lastName)}`;
    return `<img src="${user.avatar}" alt="${user.firstName || 'User'}" class="${size} rounded-full object-cover" onerror="this.onerror=null;this.replaceWith('<div class=\'${size} rounded-full bg-gray-700 text-white flex items-center justify-center font-medium\'>${fallback}</div>');">`;
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
