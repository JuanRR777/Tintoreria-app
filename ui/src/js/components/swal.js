const PRIMARY = '#0284c7'

function swal() {
  const Swal = window.Swal
  if (!Swal) throw new Error('SweetAlert2 no esta cargado')
  return Swal
}

function base(options) {
  return swal().fire({
    confirmButtonColor: PRIMARY,
    confirmButtonText: 'Listo',
    buttonsStyling: true,
    ...options,
  })
}

export function showLoading({ title, text }) {
  return swal().fire({
    title,
    text,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => swal().showLoading(),
  })
}

export function showSuccess(options) {
  return base({ icon: 'success', ...options })
}

export function showError(options) {
  return base({ icon: 'error', confirmButtonText: 'Cerrar', ...options })
}

export function showWarning(options) {
  return base({ icon: 'warning', ...options })
}
