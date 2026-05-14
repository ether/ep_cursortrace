'use strict';

const {padToggle} = require('ep_plugin_helpers/pad-toggle-server');
const toggleConfig = require('./toggle-config');

const cursortraceToggle = padToggle(toggleConfig);

exports.loadSettings = cursortraceToggle.loadSettings;
exports.clientVars = cursortraceToggle.clientVars;
exports.eejsBlock_mySettings = cursortraceToggle.eejsBlock_mySettings;
exports.eejsBlock_padSettings = cursortraceToggle.eejsBlock_padSettings;
