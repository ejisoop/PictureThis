// A module with nothing in it: used to show the flattened page photo (and the
// pencil corner marks) while the real visualization is being sketched.
export const PLACEHOLDER_MODULE = `export default function create(lp) {
  lp.controls([]);
  return { root: lp.root, enter() {}, exit() {}, update() {}, dispose() {} };
}`;
