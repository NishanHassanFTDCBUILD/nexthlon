// Staff accounts: the admin API and the staff page (Settings > Staff).
// Every change to a staff account is written to the audit log with before and after values.
const staffService = require('../services/staffService');
const auditService = require('../services/auditService');
const {
  ROLES,
  ROLE_LABELS,
  ROLE_HELP,
  PERMISSIONS,
} = require('../utils/permissions');
const {asyncHandler} = require('../utils/http');
const {HttpError} = require('../utils/http');

// GET /api/admin/staff
const listStaff = asyncHandler(async (req, res) => {
  res.json({
    staff: await staffService.list(),
    roles: ROLES.map((key) => ({
      key,
      label: ROLE_LABELS[key],
      help: ROLE_HELP[key],
    })),
  });
});

// POST /api/admin/staff   body: name, email, role
const createStaff = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const {staff, temporaryPassword} = await staffService.create({
    name: body.name,
    email: body.email,
    role: body.role,
  });
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'staff.created',
    target: `user:${staff.id}`,
    after: {name: staff.name, email: staff.email, role: staff.role},
  });
  res.status(201).json({
    message: `${staff.name} can now sign in as ${staff.roleLabel}.`,
    staff,
    // Shown once, to the owner. Not stored anywhere in clear text, and not in the audit log.
    temporaryPassword,
  });
});

// PATCH /api/admin/staff/:staffId/role   body: role
const setStaffRole = asyncHandler(async (req, res) => {
  const {before, staff} = await staffService.setRole(
    req.params.staffId,
    (req.body || {}).role,
    req.user._id,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'staff.role_changed',
    target: `user:${staff.id}`,
    before: {role: before},
    after: {role: staff.role},
  });
  res.json({message: `${staff.name} is now ${staff.roleLabel}.`, staff});
});

// PATCH /api/admin/staff/:staffId/active   body: active (true or false)
const setStaffActive = asyncHandler(async (req, res) => {
  const {active} = req.body || {};
  if (typeof active !== 'boolean')
    throw new HttpError(400, 'active must be true or false.');
  const staff = await staffService.setActive(
    req.params.staffId,
    active,
    req.user._id,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: active ? 'staff.enabled' : 'staff.disabled',
    target: `user:${staff.id}`,
    before: {active: !active},
    after: {active},
  });
  res.json({
    message: active
      ? `${staff.name} can sign in again.`
      : `${staff.name} is signed out everywhere and cannot sign in.`,
    staff,
  });
});

// ---------- Pages ----------

// GET <ADMIN_PATH>/staff
const staffPage = asyncHandler(async (req, res) => {
  res.render('admin/staff', {
    title: 'Staff | Nexthlon Admin',
    staff: await staffService.list(),
    roles: ROLES.map((key) => ({
      key,
      label: ROLE_LABELS[key],
      help: ROLE_HELP[key],
    })),
    permissions: PERMISSIONS,
  });
});

module.exports = {
  listStaff,
  createStaff,
  setStaffRole,
  setStaffActive,
  staffPage,
};
