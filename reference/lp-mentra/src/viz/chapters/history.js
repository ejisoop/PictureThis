// A text-only spread: nothing on it can be visualized. Used to show that the
// glasses stay quiet when there is nothing to bring to life.
import { PALETTE, FONTS, handText, serif, wrapParagraph } from '../paper.js';
import { noteScribble, pageToPx, PX_PER_UNIT } from '../pages.js';

export const historyChapter = {
  id: 'history',
  seed: 33,
  tabTitle: 'Interlude: lines of force',
  tabLabel: '¶',
  diag: null,

  drawLeft(ctx, pw) {
    pw.header('Interlude · A History of Fields', '210', 'left');
    pw.title('', 'Faraday’s Lines of Force', 'Historical note');
    pw.para('In the spring of 1820, during a lecture in Copenhagen, Hans Christian Ørsted noticed that a compass needle swung away from north whenever a nearby wire carried current. Electricity and magnetism, long studied as separate subjects, were evidently connected.', { dropCap: true });
    pw.para('Michael Faraday, a bookbinder’s apprentice turned laboratory assistant, took up the puzzle. Lacking formal training in mathematics, he reasoned in pictures. He imagined the space around a magnet filled with curved “lines of force”, stretched like elastic threads between the poles and pushing sideways against one another.');
    pw.para('Many of his contemporaries treated these lines as a convenient fiction. Faraday insisted that they were physically real, that the space between objects carried something, and he spent decades gathering evidence for it.');
    handText(ctx, 'Ørsted, 1820 → Faraday, 1831', 210, pw.y + 30, 38, PALETTE.sepia, { rotate: -0.03 });
  },

  drawRight(ctx, pw) {
    pw.header('Faraday’s lines of force', '211', 'right');
    pw.y = 250;
    pw.para('It was James Clerk Maxwell who finally gave Faraday’s pictures a mathematical form. In a series of papers between 1855 and 1865 he translated the lines of force into equations, and in doing so discovered that light itself is a travelling disturbance of the electric and magnetic fields.');
    pw.para('Maxwell never forgot where the idea had come from. He argued that Faraday’s way of thinking, though written without a single equation, was deeply mathematical, and that a mathematician reading Faraday would find his ideas could be expressed exactly.');
    // pull quote
    const [qx, qy] = pageToPx(0.32, 0.28);
    ctx.save();
    ctx.fillStyle = 'rgba(241,214,140,0.22)';
    ctx.fillRect(qx - 30, qy - 70, 1.5 * PX_PER_UNIT, 300);
    ctx.font = `italic 400 52px ${FONTS.serif}`;
    ctx.fillStyle = PALETTE.ink;
    wrapParagraph(ctx, '“Nothing is too wonderful to be true, if it be consistent with the laws of nature.”', qx, qy, 1.36 * PX_PER_UNIT, 66, { justify: false });
    serif(ctx, 32, { color: PALETTE.sepia });
    ctx.fillText('— Michael Faraday, laboratory notebook', qx, qy + 190);
    ctx.restore();
    pw.y = pageToPx(0, 0.82)[1];
    pw.para('Today we draw field lines in every introductory course. The next chapter returns to them — this time with numbers attached.');
    noteScribble(ctx, 210, pw.y + 30, 300, 9);
    handText(ctx, 'read for Tuesday’s seminar', 220, pw.y + 20, 36, PALETTE.graphite, { rotate: -0.03 });
  },

  drawDiagram() {},
  createViz() {
    return null;
  },
};
