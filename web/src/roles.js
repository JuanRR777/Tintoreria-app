/**
 * Roles del portal web y qué puede hacer cada uno.
 * El servidor valida estos permisos en cada endpoint; el menú solo los refleja.
 * Las recetas, pesajes y consumos por proceso no existen aquí a propósito.
 */

export const ROLES = {
  admin: 'Administrador',
  gerencia: 'Gerencia',
  compras: 'Compras',
  almacen: 'Almacén',
  consulta: 'Consulta',
}

const ALL = Object.keys(ROLES)

const PERMISSIONS = {
  'users.manage': ['admin'],
  'audit.view': ['admin'],
  'warehouses.view': ALL,
  'warehouses.manage': ['admin'],
  // Fases siguientes: se declaran ya para que el inicio muestre lo que viene.
  'inventory.view': ALL,
  'prices.view': ['admin', 'gerencia', 'compras'],
  'count.register': ['admin', 'almacen'],
  'count.approve': ['admin'],
  'purchases.view': ['admin', 'gerencia', 'compras'],
  'production.view': ALL,
}

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role)
}

export function can(role, permission) {
  return (PERMISSIONS[permission] || []).includes(role)
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((perm) => can(role, perm))
}
