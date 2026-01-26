// Open Governance UI Helpers

// Negotiation phases with descriptions
const NEGOTIATION_PHASES = {
  'not_started': { label: 'Not Started', color: 'gray', icon: '⏸️' },
  'initial': { label: 'Initial Contact', color: 'blue', icon: '👋' },
  'scope_discussion': { label: 'Scope Discussion', color: 'purple', icon: '📋' },
  'timeline_alignment': { label: 'Timeline Alignment', color: 'indigo', icon: '📅' },
  'budget_agreement': { label: 'Budget Agreement', color: 'yellow', icon: '💰' },
  'finalized': { label: 'Finalized', color: 'green', icon: '✅' }
};

// Milestone status with colors
const MILESTONE_STATUS = {
  'pending': { label: 'Pending', color: 'gray', icon: '⏳' },
  'in_progress': { label: 'In Progress', color: 'blue', icon: '🔨' },
  'completed': { label: 'Completed', color: 'yellow', icon: '✓' },
  'approved': { label: 'Approved', color: 'green', icon: '✅' },
  'disputed': { label: 'Disputed', color: 'red', icon: '⚠️' }
};

// Change order status
const CHANGE_ORDER_STATUS = {
  'pending': { label: 'Pending Review', color: 'yellow', icon: '⏳' },
  'approved': { label: 'Approved', color: 'green', icon: '✅' },
  'rejected': { label: 'Rejected', color: 'red', icon: '❌' },
  'negotiating': { label: 'Under Negotiation', color: 'blue', icon: '💬' }
};

// Render negotiation phase badge
function renderNegotiationPhase(phase) {
  const phaseInfo = NEGOTIATION_PHASES[phase] || NEGOTIATION_PHASES['not_started'];
  return `
    <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-${phaseInfo.color}-50 text-${phaseInfo.color}-700">
      <span>${phaseInfo.icon}</span>
      <span>${phaseInfo.label}</span>
    </span>
  `;
}

// Render milestone status badge
function renderMilestoneStatus(status) {
  const statusInfo = MILESTONE_STATUS[status] || MILESTONE_STATUS['pending'];
  return `
    <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-${statusInfo.color}-50 text-${statusInfo.color}-700">
      <span>${statusInfo.icon}</span>
      <span>${statusInfo.label}</span>
    </span>
  `;
}

// Render change order status badge
function renderChangeOrderStatus(status) {
  const statusInfo = CHANGE_ORDER_STATUS[status] || CHANGE_ORDER_STATUS['pending'];
  return `
    <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-${statusInfo.color}-50 text-${statusInfo.color}-700">
      <span>${statusInfo.icon}</span>
      <span>${statusInfo.label}</span>
    </span>
  `;
}

// Render activity log entry
function renderActivityLogEntry(entry) {
  const actionIcons = {
    'bid_accepted': '🤝',
    'message_proposal': '📨',
    'message_counter_proposal': '🔄',
    'message_agreement': '✅',
    'negotiation_phase_update': '📊',
    'milestone_added': '🎯',
    'milestone_completed': '✓',
    'milestone_approved': '✅',
    'change_order_requested': '📝',
    'change_order_approve': '✅',
    'change_order_reject': '❌',
    'change_order_counter': '💬'
  };
  
  const icon = actionIcons[entry.action] || '📌';
  const actor = entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'System';
  
  return `
    <div class="flex items-start gap-3 p-4 border-b border-gray-100 hover:bg-gray-50">
      <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-lg">
        ${icon}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-gray-900">
          <span class="font-medium">${actor}</span> 
          <span class="text-gray-600">${entry.details}</span>
        </p>
        <p class="text-xs text-gray-500 mt-1">${formatDate(entry.timestamp)}</p>
      </div>
    </div>
  `;
}

// Render milestone card
function renderMilestone(milestone, projectId, canComplete, canApprove) {
  return `
    <div class="border border-gray-200 rounded-lg p-6 hover:shadow-sm transition">
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-2">
            <h4 class="font-semibold text-gray-900">${milestone.title}</h4>
            ${renderMilestoneStatus(milestone.status)}
          </div>
          ${milestone.description ? `<p class="text-sm text-gray-600 mb-3">${milestone.description}</p>` : ''}
          
          <div class="grid grid-cols-2 gap-4 text-sm">
            ${milestone.amount ? `
              <div>
                <span class="text-gray-500">Payment:</span>
                <span class="font-medium text-gray-900 ml-1">${formatCurrency(milestone.amount)}</span>
              </div>
            ` : ''}
            ${milestone.dueDate ? `
              <div>
                <span class="text-gray-500">Due:</span>
                <span class="font-medium text-gray-900 ml-1">${new Date(milestone.dueDate).toLocaleDateString()}</span>
              </div>
            ` : ''}
          </div>
          
          ${milestone.deliverables && milestone.deliverables.length > 0 ? `
            <div class="mt-3">
              <p class="text-xs font-medium text-gray-700 mb-1">Deliverables:</p>
              <ul class="text-xs text-gray-600 space-y-1">
                ${milestone.deliverables.map(d => `<li>• ${d}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          ${milestone.notes ? `
            <div class="mt-3 p-3 bg-blue-50 rounded text-sm text-blue-900">
              <p class="font-medium text-xs mb-1">Completion Notes:</p>
              <p>${milestone.notes}</p>
            </div>
          ` : ''}
        </div>
      </div>
      
      <div class="flex items-center gap-2 pt-3 border-t border-gray-100">
        ${canComplete && milestone.status === 'pending' ? `
          <button onclick="showCompleteMilestoneModal('${milestone._id}')" 
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            Mark Complete
          </button>
        ` : ''}
        ${canApprove && milestone.status === 'completed' ? `
          <button onclick="approveMilestone('${projectId}', '${milestone._id}')" 
                  class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
            Approve & Release Payment
          </button>
        ` : ''}
        ${milestone.status === 'approved' ? `
          <span class="text-sm text-green-600 font-medium">✓ Payment Released</span>
        ` : ''}
      </div>
    </div>
  `;
}

// Render change order card
function renderChangeOrder(changeOrder, projectId, canRespond, currentUserId) {
  const isRequester = changeOrder.requestedBy._id === currentUserId;
  
  return `
    <div class="border border-gray-200 rounded-lg p-6 hover:shadow-sm transition">
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-2">
            <h4 class="font-semibold text-gray-900">${changeOrder.title}</h4>
            ${renderChangeOrderStatus(changeOrder.status)}
          </div>
          <p class="text-sm text-gray-600 mb-3">${changeOrder.description}</p>
          
          <div class="grid grid-cols-2 gap-4 text-sm mb-3">
            <div>
              <span class="text-gray-500">Budget Impact:</span>
              <span class="font-medium ${changeOrder.budgetImpact > 0 ? 'text-red-600' : changeOrder.budgetImpact < 0 ? 'text-green-600' : 'text-gray-900'} ml-1">
                ${changeOrder.budgetImpact > 0 ? '+' : ''}${formatCurrency(changeOrder.budgetImpact)}
              </span>
            </div>
            ${changeOrder.timelineImpact ? `
              <div>
                <span class="text-gray-500">Timeline Impact:</span>
                <span class="font-medium text-gray-900 ml-1">${changeOrder.timelineImpact}</span>
              </div>
            ` : ''}
          </div>
          
          <div class="text-xs text-gray-500">
            Requested by <span class="font-medium">${changeOrder.requestedBy.firstName} ${changeOrder.requestedBy.lastName}</span> 
            on ${formatDate(changeOrder.createdAt)}
          </div>
          
          ${changeOrder.responses && changeOrder.responses.length > 0 ? `
            <div class="mt-4 space-y-2">
              <p class="text-xs font-medium text-gray-700">Discussion:</p>
              ${changeOrder.responses.map(r => `
                <div class="p-3 bg-gray-50 rounded text-sm">
                  <p class="text-gray-900">${r.response}</p>
                  <p class="text-xs text-gray-500 mt-1">
                    ${r.decision === 'approve' ? '✅ Approved' : r.decision === 'reject' ? '❌ Rejected' : '💬 Counter-proposal'} by 
                    ${r.user.firstName} ${r.user.lastName}
                  </p>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
      
      ${canRespond && !isRequester && changeOrder.status === 'pending' || changeOrder.status === 'negotiating' ? `
        <div class="pt-3 border-t border-gray-100">
          <p class="text-sm font-medium text-gray-700 mb-2">Your Response:</p>
          <textarea id="change-order-response-${changeOrder._id}" rows="2" 
                    placeholder="Add your response..." 
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"></textarea>
          <div class="flex gap-2">
            <button onclick="respondToChangeOrder('${projectId}', '${changeOrder._id}', 'approve')" 
                    class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
              Approve
            </button>
            <button onclick="respondToChangeOrder('${projectId}', '${changeOrder._id}', 'counter')" 
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Counter
            </button>
            <button onclick="respondToChangeOrder('${projectId}', '${changeOrder._id}', 'reject')" 
                    class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              Reject
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// API helpers for governance actions
async function updateNegotiationPhase(projectId, phase) {
  try {
    const response = await authFetch(`/projects/${projectId}/negotiation-phase`, {
      method: 'PUT',
      body: JSON.stringify({ phase })
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating negotiation phase:', error);
    throw error;
  }
}

async function completeMilestone(projectId, milestoneId) {
  const notes = prompt('Add completion notes (optional):');
  try {
    const response = await authFetch(`/projects/${projectId}/milestones/${milestoneId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes })
    });
    if (response.ok) {
      alert('Milestone marked as complete!');
      location.reload();
    }
  } catch (error) {
    console.error('Error completing milestone:', error);
    alert('Failed to complete milestone');
  }
}

async function approveMilestone(projectId, milestoneId) {
  if (!confirm('Approve this milestone and release payment?')) return;
  try {
    const response = await authFetch(`/projects/${projectId}/milestones/${milestoneId}/approve`, {
      method: 'POST'
    });
    if (response.ok) {
      alert('Milestone approved and payment released!');
      location.reload();
    }
  } catch (error) {
    console.error('Error approving milestone:', error);
    alert('Failed to approve milestone');
  }
}

async function respondToChangeOrder(projectId, changeOrderId, decision) {
  const response = document.getElementById(`change-order-response-${changeOrderId}`).value.trim();
  if (!response) {
    alert('Please add a response');
    return;
  }
  
  try {
    const res = await authFetch(`/projects/${projectId}/change-orders/${changeOrderId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ response, decision })
    });
    if (res.ok) {
      alert('Response submitted!');
      location.reload();
    }
  } catch (error) {
    console.error('Error responding to change order:', error);
    alert('Failed to submit response');
  }
}
