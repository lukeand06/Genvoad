# Open Governance Framework - Genovad

## Overview
Genovad now integrates **open governance principles** into communication and project workflows to ensure transparency, alignment, and accountability between project owners and contractors.

## Key Features

### 1. **Negotiation Phase Tracking**
Projects progress through transparent phases during negotiation:
- **Initial Contact** - First discussion between parties
- **Scope Discussion** - Align on deliverables and requirements
- **Timeline Alignment** - Confirm schedule and milestones
- **Budget Agreement** - Finalize costs and payment terms
- **Finalized** - All terms agreed, ready to execute

**Benefit:** Both parties see exactly where negotiations stand. Progress isn't hidden.

### 2. **Structured Messaging for Negotiations**
Messages can be classified by type to maintain clear records:
- **Standard** - General conversation
- **Proposal** - Formal proposal of terms (scope/timeline/budget)
- **Counter Proposal** - Response to a proposal with modifications
- **Agreement** - Confirmation that both parties agree to terms
- **Change Request** - Request to modify scope/timeline/budget mid-project
- **Milestone Update** - Progress on deliverables
- **Dispute** - Disagreement or issue that needs resolution

**UI Support:** 
- Quick-action buttons for proposal/agreement/counter templates
- Message type badge shows up in chat history
- Project context preserved in messages for traceability

### 3. **Milestone-Based Project Management**
Break projects into discrete deliverables with dual sign-offs:

**Milestone Fields:**
- Title & Description
- Deliverables (list of specific outputs)
- Due Date
- Payment Amount (tied to approval)
- Status: pending → in_progress → completed → approved

**Workflow:**
1. **Contractor marks complete** - Submits work + completion notes
2. **Owner verifies & approves** - Reviews deliverables
3. **Payment released** - Automatically when milestone approved

**Benefit:** Transparent progress tracking; payment tied to actual deliverables, not just time passing.

### 4. **Change Order System**
Formal process for scope/budget/timeline changes mid-project:

**Change Order Fields:**
- Title & Description
- Budget Impact (±)
- Timeline Impact (e.g., +2 weeks)
- Status: pending → negotiating → approved/rejected
- Response History (audit trail of both parties' decisions)

**Workflow:**
1. Either party requests change
2. Other party can approve, reject, or counter-propose
3. Back-and-forth discussion tracked in the change order
4. Resolution logged with approver info

**Benefit:** Prevents scope creep and surprise cost/timeline overruns; decisions are transparent and documented.

### 5. **Activity Log (Complete Transparency)**
Every action on a project is logged with actor & timestamp:

**Logged Actions:**
- Bid accepted
- Negotiation phase updates
- Messages sent (by type: proposal, agreement, etc.)
- Milestones added/completed/approved
- Change orders requested/approved/rejected
- Disputes flagged

**Access:** Owner and contractor can view the full activity log at any time
**Benefit:** Reduces disputes; both parties have identical record of what was agreed and when.

### 6. **Two-Party Governance Messaging**
When messaging from a project card, the conversation is linked to that project:
- Project context shown in message thread
- Negotiation phase indicators guide conversation flow
- Suggested prompts align to key decision points (scope → timeline → budget → agreement)

---

## API Endpoints

### Negotiation Phase
```
PUT /api/projects/:id/negotiation-phase
Body: { phase: 'scope_discussion' | 'timeline_alignment' | 'budget_agreement' | 'finalized' }
```

### Milestones
```
POST /api/projects/:id/milestones
Body: { title, description, amount, dueDate, deliverables[] }

POST /api/projects/:id/milestones/:milestoneId/complete
Body: { notes, deliverables[] }

POST /api/projects/:id/milestones/:milestoneId/approve
```

### Change Orders
```
POST /api/projects/:id/change-orders
Body: { title, description, budgetImpact, timelineImpact }

POST /api/projects/:id/change-orders/:changeOrderId/respond
Body: { response, decision: 'approve' | 'reject' | 'counter' }
```

### Activity Log
```
GET /api/projects/:id/activity
Returns: { activityLog: [ { actor, action, details, timestamp } ] }
```

### Messages with Governance
```
POST /api/messages
Body: { 
  recipient, 
  content, 
  type: 'standard' | 'proposal' | 'counter_proposal' | 'agreement' | 'change_request',
  project: projectId (optional),
  structuredData: { proposedBudget, proposedTimeline, scopeChanges[] } (optional)
}
```

---

## User Experience Flow

### For Project Owners
1. Create project with initial scope, budget, timeline
2. Receive bids; message contractors to negotiate
3. Use "Proposal" messages to confirm scope/timeline/budget
4. Accept best bid → project moves to "in_progress"
5. Define milestones with deliverables & payment amounts
6. Contractor marks milestones complete → Owner reviews & approves
7. If scope changes needed, create formal change orders
8. Review activity log anytime to see all decisions & agreements

### For Contractors
1. Browse projects; message owners to clarify scope/budget/timeline
2. Submit bid with timeline & proposal
3. Once bid accepted, work with owner to finalize milestones
4. Use "Counter Proposal" if timeline/payment doesn't work
5. Complete milestones as agreed and submit for approval
6. Request change orders if scope changes (with impact estimates)
7. Reference activity log in disputes to show what was agreed

---

## Benefits of Open Governance

| Aspect | Traditional | Genovad Open Governance |
|--------|------------|------------------------|
| **Scope Clarity** | Often unclear; email chains get lost | Formal scope discussion phase; linked messages |
| **Timeline Confirmation** | Verbal agreement; easily disputed | Negotiation phase tracker; milestone schedule |
| **Payment Security** | Upfront payment or trust | Milestone-based releases tied to deliverables |
| **Change Management** | Ad-hoc; no clear approval process | Formal change orders; both parties respond |
| **Dispute Resolution** | "He said, she said" | Complete activity log with timestamps |
| **Accountability** | Low | High: every decision documented & attributed |

---

## Implementation Notes

### Database Schema Updates
- **Project** model: `negotiationPhase`, `milestones[]`, `changeOrders[]`, `activityLog[]`, `acceptedContractor`
- **Message** model: `type`, `project`, `milestone`, `changeOrder`, `structuredData`

### Frontend Components
- `governance.js` - Helper functions for UI rendering & API calls
- Project detail page tabs: Milestones | Change Orders | Activity Log
- Message prompts auto-classify governance messages
- Negotiation phase progress bar in sidebar

### Auto-Logging
When governance actions occur, they automatically log to `activityLog` with:
- Actor (user ID)
- Action (e.g., `message_proposal`, `milestone_approved`)
- Details (human-readable summary)
- Timestamp

---

## Next Steps

1. **Test workflow:** Create a project, accept a bid, define milestones, complete them
2. **Verify transparency:** Check activity log captures all decisions
3. **Test change orders:** Request changes mid-project and verify approval flow
4. **Messaging integration:** Send governance-typed messages and confirm they're logged
5. **Dispute scenario:** Create a disputed milestone and reference activity log to resolve

---

## Related Files
- [models/Project.js](models/Project.js) - Governance schema
- [models/Message.js](models/Message.js) - Message type classification
- [server.js](server.js) - Governance API endpoints
- [public/js/governance.js](public/js/governance.js) - UI helpers
- [project-detail.html](project-detail.html) - Governance UI tabs
- [messages.html](messages.html) - Negotiation message prompts
