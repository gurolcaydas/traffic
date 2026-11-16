import { afterEach, describe, expect, it } from 'vitest';
import { getLang, setLang, subscribeLang, t } from '../src/core/i18n';
import { LEVELS } from '../src/game/levels';
import { SHAPES } from '../src/scenarios/setup';
import { parseScenario } from '../src/scenarios/storage';

describe('language', () => {
  afterEach(() => setLang('en'));

  it('defaults to English and switches to Turkish everywhere text is read', () => {
    expect(getLang()).toBe('en');
    expect(LEVELS[0]!.title).toBe('Main street');
    let heard = 0;
    const stop = subscribeLang(() => heard++);
    setLang('tr');
    stop();
    expect(heard).toBe(1);
    expect(t('Junction', 'Kavşak')).toBe('Kavşak');
    // Text defined once at load time still follows the language when read.
    expect(LEVELS[0]!.title).toBe('Ana cadde');
    expect(SHAPES.t.label).toBe('T kavşak');
    expect(parseScenario(null).error).toBe('Bu bir trafik tasarımı değil.');
  });
});
