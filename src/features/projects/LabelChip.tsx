import { ClassChip } from '../../components'
import type { LabelClass } from '../../api/types'
import { variantForColor } from './lib'

/**
 * Label class chip: preset colors are rendered via ClassChip variants
 * (theme tokens, correct in light/dark); a custom color — via color.
 */
export function LabelChip({ label, onRemove }: { label: LabelClass; onRemove?: () => void }) {
  const variant = variantForColor(label.color)
  return variant ? (
    <ClassChip variant={variant} label={label.name} onRemove={onRemove} />
  ) : (
    <ClassChip color={label.color} label={label.name} onRemove={onRemove} />
  )
}
