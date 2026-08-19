'use strict';

// Three tiers: staff < manager < owner. Managers get everything a manager
// needs (staff, rota, payroll, requests, holiday) but can't touch other
// manager- or owner-level accounts — only an owner can do that. There's
// meant to be one owner (the pub owner); the role exists on the user record
// rather than being hardcoded to a single account, so it can be handed to
// someone else later if needed.

function roleLabel(user) {
  if (user.role === 'owner') return 'Owner';
  if (user.role === 'manager') return 'Manager';
  return user.position || 'Staff';
}

function homePathFor(user) {
  return user.role === 'owner' || user.role === 'manager' ? '/manager' : '/staff';
}

// Can `actor` view/edit/deactivate/reset-password for `target`?
// Owners can manage anyone. Managers can only manage plain staff accounts —
// not other managers, and not the owner.
function canManageUser(actor, target) {
  if (actor.role === 'owner') return true;
  return target.role === 'staff';
}

module.exports = { roleLabel, homePathFor, canManageUser };
