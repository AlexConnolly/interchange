/**
 * Which page of the Build tray a thing you can put up belongs on.
 *
 * Its own function because the alternative was the shape it had: two passes over
 * the same list of industries, one rendering `kind === 'amenity' ? null : button`
 * and the other the reverse. That works and it has a hole in it — a third kind, or
 * a rename, and an industry falls off *both* pages and is simply not in the game
 * any more, with nothing to say so. A player would report it the way this one was
 * reported: "I can't find the distribution centre."
 *
 * So the filing is one decision in one place, it is total, and the test asserts
 * every kind the content can hold lands somewhere.
 */

/** The pages that hold placeable things. `roads` is the tool page, not a list. */
export type TrayPage = 'works' | 'parish';

/**
 * Where this kind of place is filed.
 *
 * Amenities are the parish page: a green does not trade, has no contracts and never
 * appears in the Business list, so putting it beside a creamery would be filing it
 * under the wrong question. Everything else is a business.
 *
 * The default is `works` rather than a throw, deliberately. A kind nobody has
 * thought about yet showing up on the business page is a small wrongness a player
 * can still act on; the same kind vanishing is a building that does not exist.
 */
export function trayPageFor(kind: string): TrayPage {
  return kind === 'amenity' ? 'parish' : 'works';
}
