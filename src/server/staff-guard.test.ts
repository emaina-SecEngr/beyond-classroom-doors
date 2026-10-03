import { describe, expect, it } from 'vitest'
import { decideSetRole, isSetRoleMessage } from './staff-guard'

const OWNER = 'u_owner'

describe('staff changes (decision R6, standing test 17)', () => {
  it('the nonprofit admin can make someone staff', () => {
    expect(decideSetRole(OWNER, OWNER, { userId: 'u_a', role: 'admin' })).toEqual({ allow: true, targetId: 'u_a', role: 'admin' })
  })

  it('the nonprofit admin can remove staff access', () => {
    expect(decideSetRole(OWNER, OWNER, { userId: 'u_a', role: 'member' })).toEqual({ allow: true, targetId: 'u_a', role: 'member' })
  })

  it('another staff member (admin) cannot make anyone staff', () => {
    const d = decideSetRole('u_staff2', OWNER, { userId: 'u_a', role: 'admin' })
    expect(d.allow).toBe(false)
  })

  it('a member cannot promote themselves', () => {
    expect(decideSetRole('u_a', OWNER, { userId: 'u_a', role: 'admin' }).allow).toBe(false)
  })

  it('nobody can change the nonprofit admin’s own access', () => {
    expect(decideSetRole(OWNER, OWNER, { userId: OWNER, role: 'member' }).allow).toBe(false)
  })

  it('only admin or member — no other role values', () => {
    for (const role of ['viewer', 'owner', '', null, 1, 'ADMIN']) {
      expect(decideSetRole(OWNER, OWNER, { userId: 'u_a', role }).allow).toBe(false)
    }
  })

  it('refuses when no owner is configured (fails closed)', () => {
    expect(decideSetRole(OWNER, undefined, { userId: 'u_a', role: 'admin' }).allow).toBe(false)
    expect(decideSetRole('', '', { userId: 'u_a', role: 'admin' }).allow).toBe(false)
  })

  it('refuses malformed payloads', () => {
    for (const payload of [undefined, null, 'x', {}, { userId: 5, role: 'admin' }]) {
      expect(decideSetRole(OWNER, OWNER, payload).allow).toBe(false)
    }
  })

  it('recognises only the set-role message', () => {
    expect(isSetRoleMessage({ type: 'user.set_role', payload: {} })).toBe(true)
    expect(isSetRoleMessage({ type: 'record.put' })).toBe(false)
    expect(isSetRoleMessage(null)).toBe(false)
    expect(isSetRoleMessage('user.set_role')).toBe(false)
  })
})
