# Company Verification & Multi-User Team Management System

## Overview
Complete enterprise-level company verification system with automatic verification checks, manual admin review, and multi-user team management capabilities.

## Features Implemented

### 1. Company Management
- **Company Registration**: Create and claim companies with comprehensive details
- **Document Upload**: Upload verification documents (business licenses, EIN letters, insurance)
- **Company Profiles**: Full company information including address, type, size, founding year
- **Team Structure**: Owner → Admin → Member hierarchy with role-based permissions

### 2. Automated Verification
The system runs 4 automated checks:
1. **EIN Format Validation**: Verifies XX-XXXXXXX pattern
2. **Registrar ID Check**: Validates contractor license format
3. **Address Validation**: Ensures complete address information
4. **Website Domain Matching**: Compares domain to company name

**Automatic Approval**: Company auto-verifies if 2+ checks pass

### 3. Manual Verification Workflow
- **Admin Review Panel**: Platform administrators can review pending verifications
- **Document Review**: View uploaded verification documents
- **Approve/Reject**: Manual approval with rejection reason tracking
- **Notifications**: Email notifications sent on verification status change

### 4. Team Management
- **Email Invitations**: Invite team members via email with secure tokens
- **Role Assignment**: Assign as Admin or Member
- **7-Day Expiration**: Invitation tokens expire after 7 days
- **Multi-Admin Support**: Companies can have multiple administrators
- **Member Removal**: Admins can remove team members (except owner)

### 5. External API Integration Points (Ready for Implementation)
- **Dun & Bradstreet**: DUNS verification
- **State Registries**: State-level business registration checks
- **Clearbit**: Business data enrichment

## Database Schema

### Company Model
```javascript
{
  name: String,
  legalName: String,
  registrationNumber: String, // EIN
  registrarId: String, // Contractor License
  phone: String,
  email: String,
  website: String,
  type: Enum, // general_contractor, subcontractor, etc.
  size: String,
  yearFounded: Number,
  description: String,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  verified: Boolean,
  verificationStatus: Enum, // pending, submitted, in_review, verified, rejected
  verificationMethod: String, // auto, manual, hybrid
  verificationDate: Date,
  submittedAt: Date,
  owner: ObjectId, // User reference
  admins: [ObjectId], // User references
  members: [ObjectId], // User references
  verificationDocuments: [{
    type: String,
    url: String,
    uploadedAt: Date,
    verified: Boolean
  }],
  pendingInvitations: [{
    email: String,
    role: Enum, // admin, member
    token: String,
    expiresAt: Date,
    invitedAt: Date,
    invitedBy: ObjectId,
    status: Enum // pending, accepted, expired, cancelled
  }],
  externalVerification: {
    dunBradstreet: { verified: Boolean, duns: String, verifiedAt: Date },
    stateRegistry: { verified: Boolean, registryId: String, state: String, verifiedAt: Date },
    clearbit: { verified: Boolean, data: Object, verifiedAt: Date }
  },
  settings: {
    allowMemberInvites: Boolean,
    requireAdminApproval: Boolean,
    publicProfile: Boolean
  }
}
```

### User Model Updates
```javascript
{
  // ... existing fields
  companyId: ObjectId, // Reference to Company
  companyRole: Enum // owner, admin, member
}
```

## API Endpoints

### Company CRUD
- `POST /api/companies` - Create/register company
- `GET /api/companies/:id` - Get company details
- `GET /api/companies/my/company` - Get current user's company
- `PUT /api/companies/:id` - Update company (admin only)

### Verification
- `POST /api/companies/:id/submit-verification` - Submit docs for verification
- `POST /api/companies/:id/auto-verify` - Run automatic verification checks
- `POST /api/admin/companies/:id/approve` - Manual approval (platform admin)
- `POST /api/admin/companies/:id/reject` - Reject verification (platform admin)
- `GET /api/admin/companies` - List all companies for review (platform admin)

### Team Management
- `POST /api/companies/:id/invite` - Invite team member (admin only)
- `GET /api/companies/invitations/:token` - Get invitation details (public)
- `POST /api/companies/invitations/:token/accept` - Accept invitation (authenticated)
- `GET /api/companies/:id/invitations` - List pending invitations (admin only)
- `GET /api/companies/:id/members` - List company members
- `DELETE /api/companies/:id/members/:userId` - Remove member (admin only)

## Frontend Pages

### company.html
Main company management dashboard featuring:
- Company registration form
- Verification status display
- Team member management
- Invitation sending interface
- Automatic verification trigger
- Document upload

**Sections:**
- Company profile display with verification badge
- Team member list with role indicators
- Pending invitations tracker
- Admin actions (visible to admins only)

### company-invite.html
Invitation acceptance page:
- Token validation
- Company information display
- Login/signup prompts for non-authenticated users
- Accept/decline invitation buttons
- Automatic redirection to company dashboard

### admin-companies.html
Platform admin review panel:
- Statistics dashboard (pending, verified, rejected counts)
- Filter by verification status
- Company list with search
- Detailed review modal with document viewing
- Approve/reject actions with reason tracking

## Usage Flow

### For Company Owners
1. Navigate to `/company.html`
2. Click "Register Company"
3. Fill in company details and upload documents
4. Click "Run Automatic Verification" or wait for admin review
5. If auto-verified, company immediately receives verified badge
6. Invite team members via email from the dashboard

### For Team Members
1. Receive invitation email with secure link
2. Click link to open `/company-invite.html?token=xxx`
3. Sign in (or create account if needed)
4. Accept invitation
5. Redirected to company dashboard with new role

### For Platform Admins
1. Navigate to `/admin-companies.html`
2. View pending verifications in queue
3. Click company to review details and documents
4. Approve or reject with reason
5. Notification sent to company owner

## Security Features
- **JWT Authentication**: All endpoints require valid authentication
- **Role-Based Access**: Owner/admin/member permissions enforced
- **Secure Tokens**: Cryptographically secure invitation tokens
- **Token Expiration**: Invitations expire after 7 days
- **Document Upload**: File type and size validation via Multer
- **Owner Protection**: Cannot remove company owner

## Integration Notes

### Email Service (Resend)
Invitation emails are sent via the existing `sendEmail()` function with:
- Company name and inviter information
- Role assignment details
- Secure invitation link with token
- Expiration notice

### File Upload (Multer)
Documents are handled via existing Multer configuration:
- Allowed types: PDF, JPG, JPEG, PNG
- Stored in `/uploads` directory
- URLs saved to database for retrieval

## Future Enhancements
1. **External API Integration**: Connect to D&B, state registries, Clearbit
2. **Advanced Role Permissions**: Granular permission system
3. **Company Analytics**: Usage statistics and team activity
4. **Verification Levels**: Bronze/Silver/Gold verification tiers
5. **API Keys**: Company-level API access for integrations
6. **Bulk Invitations**: CSV upload for large teams
7. **SSO Integration**: Enterprise single sign-on support
8. **Audit Logs**: Track all company and team changes

## Testing Checklist
- [ ] Create new company
- [ ] Upload verification documents
- [ ] Run automatic verification
- [ ] Invite team member (admin role)
- [ ] Invite team member (member role)
- [ ] Accept invitation with existing account
- [ ] Accept invitation with new account
- [ ] Remove team member
- [ ] Admin approve verification
- [ ] Admin reject verification
- [ ] View verification status on profiles
- [ ] Company navigation link visibility

## Notes
- Platform admin role check is commented out in `/api/admin/companies` - implement role field in User model
- External verification APIs (D&B, state registry, Clearbit) are placeholders ready for implementation
- Email template uses inline styles for maximum compatibility
- All timestamps use ISO format for consistency
