import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ColorField from '@/components/ColorField.vue'
import Color from 'buefy/src/utils/color'

function mountField(hex = '#ff00ff') {
    return shallowMount(ColorField, {
        props: { modelValue: Color.parse(hex), label: 'primary color' }
    })
}

describe('ColorField', () => {
    it('shows the current color as a hex code', () => {
        const wrapper = mountField('#00ffff')
        expect((wrapper.find('input').element as HTMLInputElement).value).toBe('#00ffff')
    })

    it('emits the parsed color when a valid hex code is typed', async () => {
        const wrapper = mountField()
        await wrapper.find('input').setValue('#123456')

        const emitted = wrapper.emitted('update:modelValue')
        expect(emitted).toHaveLength(1)
        expect((emitted![0][0] as Color).toString('hex')).toBe('#123456')
    })

    it('accepts shorthand hex codes and a missing leading hash', async () => {
        const wrapper = mountField()
        await wrapper.find('input').setValue('0f0')

        const emitted = wrapper.emitted('update:modelValue')
        expect((emitted![0][0] as Color).toString('hex')).toBe('#00ff00')
    })

    it('flags invalid input without emitting', async () => {
        const wrapper = mountField()
        await wrapper.find('input').setValue('#12345')

        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
        expect(wrapper.find('input').classes()).toContain('is-danger')
    })

    it('restores the applied color when the box loses focus', async () => {
        const wrapper = mountField('#00ffff')
        await wrapper.find('input').setValue('nonsense')
        await wrapper.find('input').trigger('blur')

        expect((wrapper.find('input').element as HTMLInputElement).value).toBe('#00ffff')
        expect(wrapper.find('input').classes()).not.toContain('is-danger')
    })
})
