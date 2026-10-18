import { weekClosedMessage } from './program-week-close.service';

/** Los avisos de cierre nombran el escalón y el escudo, y nunca culpan (P4). */
describe('aviso de cierre de semana', () => {
  it('una semana cumplida dice el escalón por su nombre', () => {
    expect(weekClosedMessage({ weekNumber: 3, fulfilled: true, multiplier: 1.6, shieldUsed: false, shieldEarned: false })).toEqual({
      subject: 'Semana cumplida',
      body: 'Semana 3 cumplida · x1,6 «En llamas»',
    });
  });

  it('avisa cuando se gana el escudo', () => {
    const message = weekClosedMessage({ weekNumber: 4, fulfilled: true, multiplier: 1.8, shieldUsed: false, shieldEarned: true });
    expect(message.subject).toBe('Semana cumplida · ganaste un escudo');
    expect(message.body).toContain('x1,8 «Imparable»');
  });

  it('cuenta que el escudo cubrió la semana y que el multiplicador se conserva', () => {
    const message = weekClosedMessage({ weekNumber: 5, fulfilled: false, multiplier: 1.8, shieldUsed: true, shieldEarned: false });
    expect(message.subject).toBe('Tu escudo te cubrió');
    expect(message.body).toContain('mantiene el x1,8 «Imparable»');
  });

  it('sin escudo dice dónde queda el multiplicador y que los puntos no se pierden', () => {
    const message = weekClosedMessage({ weekNumber: 6, fulfilled: false, multiplier: 1.4, shieldUsed: false, shieldEarned: false });
    expect(message.body).toBe('Semana 6 sin completar: el multiplicador queda en x1,4 «Encendido». Tus puntos no se pierden.');
  });
});
