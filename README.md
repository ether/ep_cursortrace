![Publish Status](https://github.com/ether/ep_cursortrace/workflows/Node.js%20Package/badge.svg) [![Backend Tests Status](https://github.com/ether/ep_cursortrace/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/ether/ep_cursortrace/actions/workflows/test-and-release.yml)

# Show the caret position of authors on your Etherpad um, Pad.

Important: A caret is not a cursor, a cursor is what your mouse uses.. A caret is the little stick used in a word processor.  The more you know....

Looking for the follow feature?  See ep_author_follow

## Features
* See where another authors caret is in really real time

## TODO

* Avoid race condition where the ACE object is sent and the cursor but the cursor arrives before the event

* Add a buffer

* Show the stick on the right when the righter px of the span is greater than the total width of outerdocbody IE the name doesnt fit on the screen

* Test Coverage

## Get it done

Contact the developers through github to sponsor development of bugfixes and features

## Installation

Install from the Etherpad admin UI (**Admin → Manage Plugins**,
search for `ep_cursortrace` and click *Install*), or from the Etherpad
root directory:

```sh
pnpm run plugins install ep_cursortrace
```

> ⚠️ Don't run `npm i` / `npm install` yourself from the Etherpad
> source tree — Etherpad tracks installed plugins through its own
> plugin-manager, and hand-editing `package.json` can leave the
> server unable to start.

After installing, restart Etherpad.
