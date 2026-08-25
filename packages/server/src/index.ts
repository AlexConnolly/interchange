/**
 * What a client may import.
 *
 * The relay itself is deliberately absent. It is a Node program — sockets,
 * crypto, http — and a browser bundle that reaches this barrel must not drag
 * any of that in; run it as `node packages/server/src/relay.ts`. What is here
 * is the protocol both sides speak and the room rules both sides can reason
 * about, neither of which knows what a socket is.
 */
export * from './protocol.ts';
export * from './room.ts';
