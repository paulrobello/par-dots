// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { rangeWithButtons } from '../src/ui/setup';

function mount(value = '8') {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '4';
  input.max = '12';
  input.step = '2';
  input.value = value;
  const onInput = vi.fn();
  const root = rangeWithButtons(input, onInput);
  document.body.append(root);
  return { input, onInput, root, buttons: [...root.querySelectorAll('button')] };
}

describe('setup range controls', () => {
  it('steps by the native range step and forwards input updates', () => {
    const { input, onInput, buttons } = mount();

    buttons[0].click();
    expect(input.value).toBe('6');
    expect(onInput).toHaveBeenCalledTimes(1);
    buttons[1].click();
    expect(input.value).toBe('8');
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it('disables each button at the corresponding range limit', () => {
    const { input, buttons } = mount('4');
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);

    input.value = '12';
    input.dispatchEvent(new Event('input'));
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });
});
