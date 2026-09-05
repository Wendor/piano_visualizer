/**
 * Шейдеры сцены.
 *
 * Фигура у нас одна: прямоугольник со скруглёнными углами. Ею описывается всё —
 * нота, клавиша, полоса градиента, ореол, искра (тот же прямоугольник, только
 * повёрнутый и скруглённый до капсулы). Поэтому и программа одна, а чем именно
 * заливать, решает номер способа в атрибутах.
 *
 * Так вся сцена уезжает на видеочип одной пачкой: тысяча фигур — один вызов
 * рисования вместо тысячи заливок по холсту.
 */

/** Способ заливки. Те же числа лежат в атрибуте фигуры. */
export const MODE = {
    flat: 0,
    gradientX: 1,
    gradientY: 2,
    radial: 3,
    cloud: 4,
    stroke: 5,
    sprite: 6,
    band: 7
} as const;

export const SHAPE_VERTEX = `#version 300 es
in vec2 a_corner;
in vec4 a_rect;
in vec4 a_radii;
in vec4 a_color;
in vec4 a_params;
in vec4 a_extra;
in vec4 a_core;

uniform vec2 u_size;
uniform float u_scale;

out vec2 v_local;
out vec2 v_halfSize;
out vec4 v_radii;
out vec4 v_color;
out vec4 v_params;
out vec4 v_extra;
out vec4 v_core;
out vec2 v_uv;
out vec2 v_scene;

void main() {
    vec2 halfSize = a_rect.zw * 0.5;
    // Запас по краю: кант выходит за контур на половину своей ширины, и ещё
    // полтора пикселя нужны сглаживанию. Без запаса край срезало бы.
    float pad = a_params.z * 0.5 + 1.5 / u_scale;
    vec2 local = (a_corner - 0.5) * 2.0 * (halfSize + pad);

    float angle = a_params.w;
    vec2 turned = local;
    if (angle != 0.0) {
        float s = sin(angle);
        float c = cos(angle);
        turned = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
    }
    vec2 scene = a_rect.xy + halfSize + turned;

    v_local = local;
    v_halfSize = halfSize;
    v_radii = a_radii;
    v_color = a_color;
    v_params = a_params;
    v_extra = a_extra;
    v_core = a_core;
    v_uv = (local + halfSize) / max(a_rect.zw, vec2(0.0001));
    v_scene = scene;

    gl_Position = vec4(scene.x / u_size.x * 2.0 - 1.0, 1.0 - scene.y / u_size.y * 2.0, 0.0, 1.0);
}
`;

export const SHAPE_FRAGMENT = `#version 300 es
// Точность здесь та же, что в вершинной программе по умолчанию: расстояния
// считаются в точках сцены, а их за тысячу — mediump такое уже округляет.
precision highp float;

in vec2 v_local;
in vec2 v_halfSize;
in vec4 v_radii;
in vec4 v_color;
in vec4 v_params;
in vec4 v_extra;
in vec4 v_core;
in vec2 v_uv;
in vec2 v_scene;

uniform sampler2D u_grad;
uniform sampler2D u_cloud;
uniform sampler2D u_sprite;
uniform float u_scale;
uniform float u_rows;
uniform float u_tile;

out vec4 outColor;

/**
 * Расстояние до контура скруглённого прямоугольника: внутри отрицательное,
 * снаружи положительное. По нему сразу и заливка, и кант, и мягкий край —
 * вместо трёх разных способов рисовать одно и то же.
 */
float boxDistance(vec2 p, vec2 b, vec4 r) {
    float radius = p.x > 0.0 ? (p.y > 0.0 ? r.z : r.y) : (p.y > 0.0 ? r.w : r.x);
    radius = min(radius, min(b.x, b.y));
    vec2 q = abs(p) - b + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

vec4 gradientAt(float row, float t) {
    return texture(u_grad, vec2(clamp(t, 0.0, 1.0), (row + 0.5) / u_rows));
}

void main() {
    float mode = v_params.x;

    /*
     * Фигура тоньше пикселя не должна мерцать.
     *
     * Доля закрытой площади считается по расстоянию до контура в центре
     * пикселя. У широкой фигуры это ровно то же, что делает холст. У фигуры
     * тоньше пикселя — нет: она то попадает в центр и вспыхивает, то проходит
     * между центрами и гаснет. А в буфере свечения, который вчетверо меньше
     * экрана, тоньше пикселя почти всё: пылинка, искра, кант ноты.
     *
     * Поэтому тонкую фигуру раздуваем до пикселя и во столько же раз гасим:
     * площадь света остаётся прежней, а мерцать нечему.
     */
    float pixel = 0.5 / u_scale;
    vec2 grown = max(v_halfSize, vec2(pixel));
    float thin = (v_halfSize.x / grown.x) * (v_halfSize.y / grown.y);
    float d = boxDistance(v_local, grown, v_radii);

    float coverage;
    if (mode == 5.0) {
        float width = max(v_params.z, pixel * 2.0);
        coverage = clamp(0.5 - (abs(d) - width * 0.5) * u_scale, 0.0, 1.0) * (v_params.z / width);
    } else {
        coverage = clamp(0.5 - d * u_scale, 0.0, 1.0) * thin;
    }

    vec4 color;
    if (mode == 1.0) {
        color = gradientAt(v_params.y, v_uv.x) * v_color.a;
    } else if (mode == 2.0) {
        color = gradientAt(v_params.y, v_uv.y) * v_color.a;
    } else if (mode == 3.0) {
        color = gradientAt(v_params.y, length(v_scene - v_extra.xy) / max(v_extra.z, 0.0001)) * v_color.a;
    } else if (mode == 4.0) {
        color = texture(u_cloud, (v_local + v_halfSize + v_extra.xy) / u_tile) * v_color.a;
    } else if (mode == 6.0) {
        color = texture(u_sprite, v_uv) * v_color.a;
    } else if (mode == 7.0) {
        // По краям один цвет, посередине другой — та же ломаная из трёх точек,
        // что собрал бы холст, только считать её незачем: она и так известна.
        float t = 1.0 - abs(2.0 * (v_params.y > 0.5 ? v_uv.y : v_uv.x) - 1.0);
        color = mix(v_color, v_core, clamp(t, 0.0, 1.0));
    } else {
        color = v_color;
    }

    // Складывающийся свет — это обычное наложение с обнулённой прозрачностью:
    // src + dst * (1 - 0) и есть сумма. Так свет не разрывает пачку фигур.
    outColor = color * coverage;
    if (v_extra.w > 0.5) outColor.a = 0.0;
}
`;

/**
 * Перенос одной картинки в другую: уменьшение, увеличение и сложение. Из этого
 * собрано размытие свечения — спуск по пирамиде и подъём обратно, ровно как на
 * холсте, только считает не процессор.
 */
export const BLIT_VERTEX = `#version 300 es
in vec2 a_corner;
out vec2 v_uv;

void main() {
    v_uv = a_corner;
    gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BLIT_FRAGMENT = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_alpha;
/**
 * Размах выборки в долях картинки-источника; ноль — одна выборка.
 *
 * На спуске хватает одной: уменьшение вдвое мягкой выборкой и есть среднее по
 * четырём пикселям. На подъёме одной мало: растягивание — это ломаная по
 * решётке грубой ступени, и её изломы видны как плиты в широком ореоле.
 * Шатёр 3x3 их растворяет, и свет ложится гладко.
 */
uniform vec2 u_spread;
out vec4 outColor;

void main() {
    if (u_spread.x <= 0.0) {
        outColor = texture(u_source, v_uv) * u_alpha;
        return;
    }
    vec2 d = u_spread;
    vec4 sum = texture(u_source, v_uv) * 4.0;
    sum += (texture(u_source, v_uv + vec2(d.x, 0.0)) + texture(u_source, v_uv - vec2(d.x, 0.0))) * 2.0;
    sum += (texture(u_source, v_uv + vec2(0.0, d.y)) + texture(u_source, v_uv - vec2(0.0, d.y))) * 2.0;
    sum += texture(u_source, v_uv + d) + texture(u_source, v_uv - d);
    sum += texture(u_source, v_uv + vec2(d.x, -d.y)) + texture(u_source, v_uv + vec2(-d.x, d.y));
    outColor = sum * (u_alpha / 16.0);
}
`;
