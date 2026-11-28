import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

const buttonVariants = cva('button', {
  variants: {
    variant: { default: '', primary: 'button-primary', ghost: 'button-ghost' },
  },
  defaultVariants: { variant: 'default' },
})

export function Button({ className, variant, asChild, type, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {
  asChild?: boolean
}) {
  const Component = asChild ? Slot : 'button'
  return <Component data-slot="button" className={buttonVariants({ variant, className })} type={asChild ? undefined : type || 'button'} {...props} />
}
