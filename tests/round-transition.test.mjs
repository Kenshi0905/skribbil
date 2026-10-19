import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoundTransition} from '../engine/internal/frontend/resources/round-transition.js';

function fixture({reduced = false} = {}) {
    const timers = new Map(), animations = []; let nextTimer = 0;
    class Element {
        children = []; dataset = {}; attributes = {}; hidden = false; textContent = ''; visibility = 'visible';
        append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
        prepend(node) { node.parent = this; this.children.unshift(node); }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(name, callback) { this[name] = callback; }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
        getContext() { return { drawImage: source => { this.snapshot = source; } }; }
        animate() {
            let resolve, reject;
            const animation = {finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
                cancel() { this.cancelled = true; reject(Error('cancelled')); }, resolve: () => resolve()};
            animations.push(animation); return animation;
        }
    }
    const wrapper = new Element(), body = new Element(), panels = [new Element(), new Element(), new Element()];
    wrapper.ownerDocument = {createElement: () => new Element()};
    const board = {width:1600, height:900};
    const view = {matchMedia: () => ({matches:reduced}), getComputedStyle: node => ({visibility:node.visibility}),
        setTimeout: (callback, duration) => { timers.set(++nextTimer, {callback, duration}); return nextTimer; },
        clearTimeout: id => timers.delete(id)};
    const ui = createRoundTransition({board, wrapper, panels, body, view});
    const overlay = wrapper.children[0], announcement = wrapper.children[1];
    return {ui, wrapper, body, board, panels, timers, overlay, announcement, animations};
}

test('server answer is revealed, then choosing panels remain available with a compact answer summary', () => {
    const f = fixture({reduced:true});
    f.ui.reveal('nose ring');
    assert.equal(f.body.dataset.roundReveal, 'true');
    assert.equal(f.overlay.hidden, false);
    assert.equal(f.announcement.textContent, 'The word was nose ring.');
    assert.equal(f.timers.values().next().value.duration, 1600);
    const artwork = f.wrapper.children.at(-1);
    assert.equal(artwork.snapshot, f.board); assert.equal(artwork.width, 1600); assert.equal(artwork.height, 900);
    for (const panel of f.panels) {
        const summary = panel.children[0];
        assert.equal(summary.hidden, false); assert.equal(summary.children[1].textContent, 'nose ring');
    }
    f.timers.values().next().value.callback();
    assert.equal(f.overlay.hidden, true); assert.equal(f.body.dataset.roundReveal, undefined);
    assert.equal(f.body.dataset.roundAnswer, 'true');
    assert.ok(f.wrapper.children.includes(artwork), 'finished drawing stays behind the choosing panel');
});

test('a fast word choice immediately cancels the reveal, including an unfinished exit animation', async () => {
    const f = fixture(); f.ui.reveal('house'); f.ui.finish();
    const exiting = f.animations[1];
    f.ui.begin();
    assert.equal(f.overlay.hidden, true); assert.equal(f.timers.size, 0);
    assert.equal(f.body.dataset.roundAnswer, undefined);
    assert.equal(f.wrapper.children.filter(node => node.className === 'round-finished-artwork').length, 0);
    assert.ok(f.panels.every(panel => panel.children[0].hidden));
    assert.ok(f.animations.every(animation => animation.cancelled));
    f.ui.reveal('new answer'); exiting.resolve(); await Promise.resolve();
    assert.equal(f.overlay.hidden, false, 'stale exit completion cannot hide a later turn');
    assert.equal(f.announcement.textContent, 'The word was new answer.');
});

test('initial turns and wordless disconnects do not invent or retain an answer', () => {
    const f = fixture(); f.ui.begin(); f.ui.reveal('');
    assert.equal(f.overlay.hidden, true); assert.equal(f.timers.size, 0);
    f.ui.reveal('tree'); f.ui.reveal(undefined, 'drawer_disconnected');
    assert.equal(f.overlay.hidden, true); assert.equal(f.body.dataset.roundAnswer, undefined);
    assert.equal(f.announcement.textContent, '');
});

test('custom and Unicode answers are text and advance automatically with reduced motion', () => {
    const f = fixture({reduced:true});
    const word = '<img src=x> café 🐈'; f.ui.reveal(word, 'drawer_disconnected');
    assert.equal(f.panels[0].children[0].children[1].textContent, word);
    assert.equal(f.overlay.children[0].children[2].textContent, 'The drawer left the room.');
    assert.equal(f.animations.length, 0);
    assert.equal(f.overlay.children[0].children.length, 3, 'no manual Continue control');
    f.timers.values().next().value.callback();
    assert.equal(f.overlay.hidden, true); assert.equal(f.timers.size, 0);
});
