/** До какой доли громкости хвост доходит к концу: −60 дБ, как принято для залов. */
const TAIL = 0.001;

/**
 * Отражения зала: затухающий шум для свёртки.
 *
 * Затухание считается умножением на постоянный множитель, а не возведением в
 * степень на каждом отсчёте. Импульс — это три сотни тысяч отсчётов, и дробная
 * степень столько раз обходится в десятки миллисекунд: ровно тот рывок,
 * который видно на первой сыгранной ноте.
 */
export function fillImpulse(
    left: Float32Array,
    right: Float32Array,
    random: () => number = Math.random
): void {
    const length = Math.min(left.length, right.length);
    if (length === 0) return;

    const step = Math.pow(TAIL, 1 / length);
    let decay = 1;
    for (let i = 0; i < length; i++) {
        // Каналы заполняем разным шумом: одинаковые сделали бы зал плоским.
        left[i] = (random() * 2 - 1) * decay;
        right[i] = (random() * 2 - 1) * decay;
        decay *= step;
    }
}
