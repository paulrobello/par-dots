import { describe, expect, it } from 'vitest';
import { describeColor } from '../src/engine/colorNames';

describe('descriptive color names', () => {
  it('matches the renderer hex formats used by imported palettes', () => {
    expect(describeColor('#fff')).toBe('White');
    expect(describeColor(' FfF ')).toBe('White');
    expect(describeColor('#f00')).toBe('Red');
    expect(describeColor(' 963F26 ')).toBe('Rust');
    expect(describeColor('invalid')).toBe('Gray');
  });

  it('names neutral boundaries', () => {
    expect(describeColor('#080608')).toBe('Black');
    expect(describeColor('#eeeeee')).toBe('White');
    expect(describeColor('#808080')).toBe('Gray');
    expect(describeColor('#303030')).toBe('Dark Gray');
    expect(describeColor('#d8d8d8')).toBe('Light Gray');
    expect(describeColor('#f5f5dc')).toBe('Beige');
    expect(describeColor('#e6e6fa')).toBe('Lavender');
  });

  it('names primary and secondary colors', () => {
    expect(describeColor('#c91a09')).toBe('Red');
    expect(describeColor('#0055bf')).toBe('Blue');
    expect(describeColor('#f2cd37')).toBe('Yellow');
    expect(describeColor('#00a651')).toBe('Green');
    expect(describeColor('#008f9c')).toBe('Teal');
    expect(describeColor('#00ffff')).toBe('Cyan');
    expect(describeColor('#6b2fb3')).toBe('Purple');
    expect(describeColor('#b19cd9')).toBe('Lavender');
  });

  it('keeps muted and warm shades descriptive', () => {
    expect(describeColor('#381921')).toBe('Burgundy');
    expect(describeColor('#703322')).toBe('Brown');
    expect(describeColor('#963f26')).toBe('Rust');
    expect(describeColor('#efac6c')).toBe('Peach');
    expect(describeColor('#808000')).toBe('Olive');
    expect(describeColor('#d2b48c')).toBe('Tan');
    expect(describeColor('#101c38')).toBe('Navy');
    expect(describeColor('#183d24')).toBe('Dark Green');
    expect(describeColor('#9ad9a2')).toBe('Light Green');
    expect(describeColor('#b8d5f2')).toBe('Light Blue');
    expect(describeColor('#d9eafa')).toBe('Light Blue');
    expect(describeColor('#0000ff')).toBe('Blue');
  });
});
