// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { captureTimetableScroll, restoreTimetableScroll } from './timetableScrollAnchor';

afterEach(() => { document.body.innerHTML = ''; });

describe('timetable drop scroll position', () => {
  it('keeps the visible tail card in place when a preceding cool changes height', () => {
    const scroller = document.createElement('div');
    const heading = document.createElement('div');
    heading.dataset.coolIndex = '0';
    const dragged = document.createElement('div');
    dragged.dataset.entryId = 'dragged';
    const tail = document.createElement('div');
    tail.dataset.entryId = 'tail';
    scroller.append(heading, dragged, tail);
    document.body.append(scroller);
    scroller.scrollTop = 500;
    let precedingHeight = 600;
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 } as DOMRect);
    heading.getBoundingClientRect = () => ({ top: -500, bottom: 300 } as DOMRect);
    dragged.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0 } as DOMRect);
    tail.getBoundingClientRect = () => ({
      top: precedingHeight - scroller.scrollTop,
      bottom: precedingHeight - scroller.scrollTop + 56,
      height: 56,
    } as DOMRect);

    const snapshot = captureTimetableScroll(scroller, 'dragged');
    expect(snapshot.anchor).toBe(tail);
    precedingHeight -= 56;
    restoreTimetableScroll(snapshot);

    expect(scroller.scrollTop).toBe(444);
    expect(tail.getBoundingClientRect().top).toBe(snapshot.anchorTop);
  });
});
