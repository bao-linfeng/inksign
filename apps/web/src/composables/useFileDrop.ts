import { onBeforeUnmount, onMounted, ref } from 'vue'

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Accepts a file dropped anywhere on the window (PRD FR-01: one PDF at a time, so only the first
 * file is used). It also stops the browser from navigating away to the dropped file.
 */
export function useFileDrop(onFile: (file: File) => void) {
  /** A file is being dragged over the window */
  const dragging = ref(false)
  // dragenter/dragleave fire for every child element crossed
  let depth = 0

  function onDragEnter(event: DragEvent) {
    if (!carriesFiles(event))
      return
    depth++
    dragging.value = true
  }

  function onDragLeave(event: DragEvent) {
    if (!carriesFiles(event))
      return
    depth = Math.max(0, depth - 1)
    dragging.value = depth > 0
  }

  function onDragOver(event: DragEvent) {
    if (!carriesFiles(event))
      return
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'
  }

  function onDrop(event: DragEvent) {
    if (!carriesFiles(event))
      return
    event.preventDefault()
    depth = 0
    dragging.value = false
    const file = event.dataTransfer?.files[0]
    if (file)
      onFile(file)
  }

  const listeners = { dragenter: onDragEnter, dragleave: onDragLeave, dragover: onDragOver, drop: onDrop }

  onMounted(() => {
    for (const [type, listener] of Object.entries(listeners))
      window.addEventListener(type, listener as EventListener)
  })
  onBeforeUnmount(() => {
    for (const [type, listener] of Object.entries(listeners))
      window.removeEventListener(type, listener as EventListener)
  })

  return { dragging }
}
