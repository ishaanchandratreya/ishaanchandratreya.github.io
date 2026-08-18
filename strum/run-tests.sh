#!/bin/bash
set -e
echo "== engine =="; node test/engine.test.js
echo "== dom ==";    node test/dom.test.js
