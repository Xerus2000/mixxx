var DJ505 = {};

/////////////////
// Tweakables. //
/////////////////

DJ505.stripSearchScaling = 50;
DJ505.tempoRange = [0.08, 0.16, 0.5];
DJ505.autoFocusEffects = false;
DJ505.autoShowFourDecks = false;
DJ505.bindSamplerControls = false;


///////////
// Code. //
///////////

DJ505.init = function () {

    DJ505.shiftButton = function (channel, control, value, status, group) {
        DJ505.deck.concat(DJ505.effectUnit, DJ505.sampler).forEach(
            value ? function (module) { module.shift(); } : function (module) { module.unshift(); }
        );
    };

    DJ505.leftDeck = new DJ505.Deck([1,3], 0);
    DJ505.rightDeck = new DJ505.Deck([2,4], 1);
    DJ505.deck = [DJ505.leftDeck, DJ505.rightDeck];

    DJ505.sampler = new DJ505.Sampler();
    DJ505.sampler.reconnectComponents();

    DJ505.effectUnit = [];
    for(var i = 0; i <= 1; i++) {
        DJ505.effectUnit[i] = new DJ505.EffectUnit([i + 1, i + 3]);
        DJ505.effectUnit[i].sendShifted = false;
        DJ505.effectUnit[i].shiftOffset = 0x0B;
        DJ505.effectUnit[i].shiftControl = true;
        DJ505.effectUnit[i].enableButtons[1].midi = [0x98 + i, 0x00];
        DJ505.effectUnit[i].enableButtons[2].midi = [0x98 + i, 0x01];
        DJ505.effectUnit[i].enableButtons[3].midi = [0x98 + i, 0x02];
        DJ505.effectUnit[i].effectFocusButton.midi = [0x98 + i, 0x04];
        DJ505.effectUnit[i].knobs[1].midi = [0xB8 + i, 0x00];
        DJ505.effectUnit[i].knobs[2].midi = [0xB8 + i, 0x01];
        DJ505.effectUnit[i].knobs[3].midi = [0xB8 + i, 0x02];
        DJ505.effectUnit[i].dryWetKnob.midi = [0xB8 + i, 0x03];
        DJ505.effectUnit[i].dryWetKnob.input = function (channel, control, value, status, group) {
            if (value === 1) {
               // 0.05 is an example. Adjust that value to whatever works well for your controller.
               this.inSetParameter(this.inGetParameter() + 0.05);
            } else if (value === 127) {
               this.inSetParameter(this.inGetParameter() - 0.05);
            }
        };
        for(var j = 1; j <= 4; j++) {
            DJ505.effectUnit[i].enableOnChannelButtons.addButton('Channel' + j);
            DJ505.effectUnit[i].enableOnChannelButtons['Channel' + j].midi = [0x98 + i, 0x04 + j];
        }
        DJ505.effectUnit[i].init();
    }

    engine.makeConnection('[Channel3]', 'track_loaded', DJ505.autoShowDecks);
    engine.makeConnection('[Channel4]', 'track_loaded', DJ505.autoShowDecks);

    if (engine.getValue('[Master]', 'num_samplers') < 16) {
        engine.setValue('[Master]', 'num_samplers', 16);
    }

    midi.sendSysexMsg([0xF0, 0x00, 0x20, 0x7F, 0x00, 0xF7], 6); //request initial state
    midi.sendSysexMsg([0xF0, 0x00, 0x20, 0x7F, 0x01, 0xF7], 6); //unlock pad layers

    DJ505.leftDeck.setCurrentDeck('[Channel1]');
    DJ505.rightDeck.setCurrentDeck('[Channel2]');

};

DJ505.autoShowDecks = function (value, group, control) {
    var any_loaded = engine.getValue('[Channel3]', 'track_loaded') || engine.getValue('[Channel4]', 'track_loaded');
    if (!DJ505.autoShowFourDecks) {
        return;
    }
    engine.setValue('[Master]', 'show_4decks', any_loaded);
};

DJ505.shutdown = function () {
};

DJ505.browseEncoder = new components.Encoder({
    input: function (channel, control, value, status, group) {
        var isShifted = control % 2 != 0;
        switch (status) {
        case 0xBF: // Rotate.
            if (value === 127) {
                script.triggerControl(group, isShifted ? 'ScrollUp' : 'MoveUp');
            } else if (value === 1) {
                script.triggerControl(group, isShifted ? 'ScrollDown' : 'MoveDown');
            }
            break;
        case 0x9F: // Push.
            if (value) {
                script.triggerControl(group, isShifted ? 'MoveFocusBackward' : 'MoveFocusForward');
            }
        }
    }
});

DJ505.crossfader = new components.Pot({
    midi: [0xBF, 0x08],
    group: '[Master]',
    inKey: 'crossfader',
    input: function () {
        // We need a weird max. for the crossfader to make it cut cleanly.
        // However, components.js resets max. to 0x3fff when the first value is
        // received. Hence, we need to set max. here instead of within the
        // constructor.
        this.max = (0x7f<<7) + 0x70;
        components.Pot.prototype.input.apply(this, arguments);
    }
});

DJ505.Deck = function (deckNumbers, offset) {
    components.Deck.call(this, deckNumbers);
    channel = offset+1;

    this.loadTrack = new components.Button({
        midi: [0x9F, 0x02 + offset],
        unshift: function () {
            this.inKey = 'LoadSelectedTrack';
        },
        shift: function () {
            this.inKey = 'eject';
        },
    });

    this.slipModeButton = new DJ505.SlipModeButton();

    engine.setValue(this.currentDeck, "rate_dir", -1);
    this.tempoFader = new components.Pot({
        group: this.currentDeck,
        midi: [0xB0 + offset, 0x09],
        connect: function () {
            engine.softTakeover(this.group, 'pitch', true);
            engine.softTakeover(this.group, 'rate', true);
            components.Pot.prototype.connect.apply(this, arguments);
        },
        unshift: function () {
            this.inKey = 'rate';
            this.inSetParameter = components.Pot.prototype.inSetParameter;
            engine.softTakeoverIgnoreNextValue(this.group, 'pitch');
        },
        shift: function () {
            this.inKey = 'pitch';
            this.inSetParameter = function (value) {
                // Scale to interval ]-7…7[; invert direction as per controller
                // labeling.
                value = 14 * value - 7;
                value *= -1;
                components.Pot.prototype.inSetValue.call(this, value);
            };
            engine.softTakeoverIgnoreNextValue(this.group, 'rate');
        }
    });


    // ============================= JOG WHEELS =================================
    this.wheelTouch = function (channel, control, value, status, group) {
      if (value === 0x7F && !this.isShifted) {
            var alpha = 1.0/8;
            var beta = alpha/32;
            engine.scratchEnable(script.deckFromGroup(this.currentDeck), 512, 45, alpha, beta);
        } else {    // If button up
            engine.scratchDisable(script.deckFromGroup(this.currentDeck));
        }
    };

    this.wheelTurn = function (channel, control, value, status, group) {
        var newValue = value - 64;
        var deck = script.deckFromGroup(this.currentDeck);
        if (engine.isScratching(deck)) {
            engine.scratchTick(deck, newValue); // Scratch!
        } else if (this.isShifted) {
            // Strip search.
            var oldPos = engine.getValue(this.currentDeck, 'playposition');
            // Scale to interval [0,1].
            newValue = newValue / 0xff;
            // Since ‘playposition’ is normalized to unity, we need to scale by
            // song duration in order for the jog wheel to cover the same amount
            // of time given a constant turning angle.
            var duration = engine.getValue(this.currentDeck, 'duration');
            newValue = newValue / duration;
            var newPos = Math.max(0, oldPos + newValue * DJ505.stripSearchScaling);
            engine.setValue(this.currentDeck, 'playposition', newPos);
        } else {
            engine.setValue(this.currentDeck, 'jog', newValue); // Pitch bend
        }
    };


    // ========================== LOOP SECTION ==============================

    this.loopActive = new components.Button({
        midi: [0x94 + offset, 0x32],
        inKey: 'reloop_toggle',
        outKey: 'loop_enabled',
    });
    this.reloopExit = new components.Button({
        midi: [0x94 + offset, 0x33],
        key: 'reloop_andstop',
    });
    this.loopHalve = new components.Button({
        midi: [0x94 + offset, 0x34],
        key: 'loop_halve',
    });
    this.loopDouble = new components.Button({
        midi: [0x94 + offset, 0x35],
        key: 'loop_double',
    });
    this.loopShiftBackward = new components.Button({
        midi: [0x94 + offset, 0x36],
        key: 'beatjump_backward',
    });
    this.loopShiftForward = new components.Button({
        midi: [0x94 + offset, 0x37],
        key: 'beatjump_forward',
    });
    this.loopIn = new components.Button({
        midi: [0x94 + offset, 0x38],
        key: 'loop_in',
    });
    this.loopOut = new components.Button({
        midi: [0x94 + offset, 0x39],
        key: 'loop_out',
    });
    this.autoLoop = new components.Button({
        midi: [0x94 + offset, 0x40],
        inKey: 'beatloop_activate',
        outKey: 'loop_enabled',
        input: function (channel, control, value, status, group) {
            components.Button.prototype.input.call(this, channel, control, value, status, group);
            if (value) {
                return;
            }
            this.trigger();
        },
    });


    // ========================== PERFORMANCE PADS ==============================

    this.padSection = new DJ505.PadSection(this);
    this.keylock = new DJ505.KeylockButton(this.padSection.paramPlusMinus);

    // ============================= TRANSPORT ==================================

    this.cue = new components.CueButton({
        midi: [0x90 + offset, 0x1],
        sendShifted: true,
        shiftChannel: true,
        shiftOffset: 2,
        reverseRollOnShift: true,
        input: function (channel, control, value, status, group) {
            components.CueButton.prototype.input.call(this, channel, control, value, status, group);
            if (value) {
                return;
            }
            var state = engine.getValue(group, 'cue_indicator');
            if (state) {
                this.trigger();
            }
        }
    });

    this.play = new components.Button({
        midi: [0x90 + offset, 0],
        sendShifted: true,
        shiftChannel: true,
        shiftOffset: 2,
        outKey: 'play_indicator',
        unshift: function () {
            this.inKey = 'play';
            this.input = function (channel, control, value, status, group) {

                if (value) {                                    // Button press.
                    this.longPressStart = new Date();
                    this.longPressTimer = engine.beginTimer(
                        this.longPressTimeout,
                        function () { this.longPressed = true; },
                        true
                    );
                    return;
                }                                       // Else: Button release.

                var isPlaying = engine.getValue(group, 'play');

                // Normalize ‘isPlaying’ – we consider the braking state
                // equivalent to being stopped, so that pressing play again can
                // trigger a soft-startup even before the brake is complete.
                if (this.isBraking !== undefined) {
                    isPlaying = isPlaying && !this.isBraking;
                }

                if (this.longPressed) {             // Release after long press.
                    var deck = script.deckFromGroup(group);
                    var pressDuration = new Date() - this.longPressStart;
                    if (isPlaying && !this.isBraking) {
                        engine.brake(deck, true, 1000 / pressDuration);
                        this.isBraking = true;
                    } else {
                        engine.softStart(deck, true, 1000 / pressDuration);
                        this.isBraking = false;
                    }
                    this.longPressed = false;
                    return;
                }                            // Else: Release after short press.

                this.isBraking = false;
                script.toggleControl(group, 'play', !isPlaying);

                if (this.longPressTimer) {
                    engine.stopTimer(this.longPressTimer);
                    this.longPressTimer = null;
                }
            };
        },
        shift: function () {
            this.inKey = 'reverse';
            this.input = function (channel, control, value, status, group) {
                components.Button.prototype.input.apply(this, arguments);
                if(!value) {
                    this.trigger();
                }

            };
        }
    });

    this.sync = new DJ505.SyncButton({group: this.currentDeck});

    // =============================== MIXER ====================================
    this.pregain = new components.Pot({
            group: this.currentDeck,
            midi: [0xB0 + offset, 0x16],
            inKey: 'pregain',
    });

    this.eqKnob = [];
    for (var k = 1; k <= 3; k++) {
        this.eqKnob[k] = new components.Pot({
            midi: [0xB0 + offset, 0x20 - k],
            group: '[EqualizerRack1_' + this.currentDeck + '_Effect1]',
            inKey: 'parameter' + k,
        });
    }

    this.filter = new components.Pot({
        midi: [0xB0 + offset, 0x1A],
        group: '[QuickEffectRack1_' + this.currentDeck + ']',
        inKey: 'super1',
    });

    this.pfl = new components.Button({
        sendShifted: true,
        shiftChannel: true,
        shiftOffset: 2,
        midi: [0x90 + offset, 0x1B],
        type: components.Button.prototype.types.toggle,
        inKey: 'pfl',
        outKey: 'pfl',
    });

    this.tapBPM = new components.Button({
        input: function (channel, control, value, status, group) {
        if (value == 127) {
                script.triggerControl(group, 'beats_translate_curpos');
                bpm.tapButton(script.deckFromGroup(group));
                this.longPressTimer = engine.beginTimer(
                    this.longPressTimeout,
                    function () {
                        script.triggerControl(group, 'beats_translate_match_alignment');
                    },
                    true
                );
            } else {
                engine.stopTimer(this.longPressTimer);
        }
        }
    });

    this.volume = new components.Pot({
        group: this.currentDeck,
        midi: [0xB0 + offset, 0x1C],
        inKey: 'volume',
    });

    this.setDeck = new components.Button({
        midi: [0x90 + offset, 0x08],
        deck: this,
        input: function (channel, control, value, status, group) {
            var currentDeck = script.deckFromGroup(this.deck.currentDeck);
            var otherDeck = currentDeck == deckNumbers[0] ? deckNumbers[1] : deckNumbers[0];

            otherDeck = '[Channel' + otherDeck + ']';

            if (value) {                                        // Button press.
                this.longPressTimer = engine.beginTimer(
                    this.longPressTimeout,
                    function () { this.isLongPressed = true; },
                    true
                );
                this.deck.setCurrentDeck(otherDeck);
                return;
            }                                           // Else: Button release.

            if (this.longPressTimer) {
                engine.stopTimer(this.longPressTimer);
                this.longPressTimer = null;
            }

            // Since we are in the release phase, currentDeck still reflects the
            // switched decks. So if we are now using deck 1/3, we were
            // originally using deck 2/4 and vice versa.
            var deckWasVanilla = currentDeck == deckNumbers[1];

            if (this.isLongPressed) {                     // Release long press.
                this.isLongPressed = false;
                // Return to the original state.
                this.send(deckWasVanilla ? 0 : 0x7f);
                this.deck.setCurrentDeck(otherDeck);
                return;
            }                                      // Else: Release short press.

            // Invert the deck state.
            this.send(deckWasVanilla ? 0x7f : 0);
        }
    });

    this.setCurrentDeck = function (deck) {
        components.Deck.prototype.setCurrentDeck.call(this, deck);
        DJ505.effectUnit[offset + 1].focusedDeck = script.deckFromGroup(deck);
        DJ505.effectUnit[offset + 1].reconnect();
    };

};

DJ505.Deck.prototype = Object.create(components.Deck.prototype);


///////////////////////////////////////////////////////////////
//                             FX                            //
///////////////////////////////////////////////////////////////

DJ505.EffectUnit = function (unitNumbers, allowFocusWhenParametersHidden, colors) {
    var eu = this;
    this.focusChooseModeActive = false;

    // This is only connected if allowFocusWhenParametersHidden is false.
    this.onShowParametersChange = function (value) {
        if (value === 0) {
            // Prevent this from getting called twice (on button down and button up)
            // when show_parameters button is clicked in skin.
            // Otherwise this.previouslyFocusedEffect would always be set to 0
            // on the second call.
            if (engine.getValue(eu.group, 'show_focus') > 0) {
                engine.setValue(eu.group, 'show_focus', 0);
                eu.previouslyFocusedEffect = engine.getValue(eu.group,
                                                              "focused_effect");
                engine.setValue(eu.group, "focused_effect", 0);
            }
        } else {
            engine.setValue(eu.group, 'show_focus', 1);
            if (eu.previouslyFocusedEffect !== undefined) {
                engine.setValue(eu.group, 'focused_effect',
                                eu.previouslyFocusedEffect);
            }
        }
        if (eu.enableButtons !== undefined) {
            eu.enableButtons.reconnectComponents(function (button) {
                button.stopEffectFocusChooseMode();
            });
        }
    };

    this.setCurrentUnit = function (newNumber) {
        this.currentUnitNumber = newNumber;
        if (allowFocusWhenParametersHidden) {
            engine.setValue(this.group, 'show_focus', 0);
        } else {
            if (this.showParametersConnection !== undefined) {
                this.showParametersConnection.disconnect();
            }
            delete this.previouslyFocusedEffect;
        }

        this.group = '[EffectRack1_EffectUnit' + newNumber + ']';

        if (allowFocusWhenParametersHidden) {
            engine.setValue(this.group, 'show_focus', 1);
        } else {
            // Connect a callback to show_parameters changing instead of
            // setting show_focus when effectFocusButton is pressed so
            // show_focus is always in the correct state, even if the user
            // presses the skin button for show_parameters.
            this.showParametersConnection = engine.makeConnection(this.group,
                                                'show_parameters',
                                                this.onShowParametersChange);
            this.showParametersConnection.trigger();
        }

        // Do not enable soft takeover upon EffectUnit construction
        // so initial values can be loaded from knobs.
        if (this.hasInitialized === true) {
            for (var n = 1; n <= 3; n++) {
                var effect = '[EffectRack1_EffectUnit' + this.currentUnitNumber +
                            '_Effect' + n + ']';
                engine.softTakeover(effect, 'meta', true);
                engine.softTakeover(effect, 'parameter1', true);
                engine.softTakeover(effect, 'parameter2', true);
                engine.softTakeover(effect, 'parameter3', true);
            }
        }

        this.reconnectComponents(function (component) {
            // update [EffectRack1_EffectUnitX] groups
            var unitMatch = component.group.match(script.effectUnitRegEx);
            if (unitMatch !== null) {
                component.group = eu.group;
            } else {
                // update [EffectRack1_EffectUnitX_EffectY] groups
                var effectMatch = component.group.match(script.individualEffectRegEx);
                if (effectMatch !== null) {
                    component.group = '[EffectRack1_EffectUnit' +
                                      eu.currentUnitNumber +
                                      '_Effect' + effectMatch[2] + ']';
                }
            }
        });
    };

    this.toggle = function () {
        // cycle through unitNumbers array
        var index = this.unitNumbers.indexOf(this.currentUnitNumber);
        if (index === (this.unitNumbers.length - 1)) {
            index = 0;
        } else {
            index += 1;
        }
        this.setCurrentUnit(this.unitNumbers[index]);
    }

    if (unitNumbers !== undefined) {
        if (Array.isArray(unitNumbers)) {
            this.unitNumbers = unitNumbers;
            this.setCurrentUnit(unitNumbers[0]);
        } else if (typeof unitNumbers === 'number' &&
                  Math.floor(unitNumbers) === unitNumbers &&
                  isFinite(unitNumbers)) {
            this.unitNumbers = [unitNumbers];
            this.setCurrentUnit(unitNumbers);
        }
    } else {
        print('ERROR! new EffectUnit() called without specifying any unit numbers!');
        return;
    }

    this.dryWetKnob = new components.Pot({
        group: this.group,
        unshift: function () {
            this.inKey = 'mix';
            // for soft takeover
            this.disconnect();
            this.connect();
        },
        shift: function () {
            this.inKey = 'super1';
            // for soft takeover
            this.disconnect();
            this.connect();
            // engine.softTakeoverIgnoreNextValue is called
            // in the knobs' onFocusChange function
            eu.knobs.forEachComponent(function (knob) {
                knob.trigger();
            });
        },
        outConnect: false,
    });

    this.enableOnChannelButtons = new components.ComponentContainer();
    this.enableOnChannelButtons.addButton = function (channel) {
        this[channel] = new components.Button({
            group: eu.group,
            key: 'group_[' + channel + ']_enable',
            type: components.Button.prototype.types.toggle,
            outConnect: true,
            input: function (channel, control, value, status, group) {
                components.Button.prototype.input.call(this, channel, control, value, status, group);
                this.trigger();
            },
        });
    };

    this.EffectUnitKnob = function (number) {
        this.number = number;
        components.Pot.call(this);
    };
    this.EffectUnitKnob.prototype = new components.Pot({
        group: this.group,
        unshift: function () {
            this.input = function (channel, control, value, status, group) {
                if (this.MSB !== undefined) {
                    value = (this.MSB << 7) + value;
                }
                this.inSetParameter(this.inValueScale(value));

                if (this.previousValueReceived === undefined) {
                    var effect = '[EffectRack1_EffectUnit' + eu.currentUnitNumber +
                                '_Effect' + this.number + ']';
                    engine.softTakeover(effect, 'meta', true);
                    engine.softTakeover(effect, 'parameter1', true);
                    engine.softTakeover(effect, 'parameter2', true);
                    engine.softTakeover(effect, 'parameter3', true);
                }
                this.previousValueReceived = value;
            };
        },
        shift: function () {
            engine.softTakeoverIgnoreNextValue(this.group, this.inKey);
            this.valueAtLastEffectSwitch = this.previousValueReceived;
            // Floor the threshold to ensure that every effect can be selected
            this.changeThreshold = Math.floor(this.max /
                engine.getValue('[Master]', 'num_effectsavailable'));

            this.input = function (channel, control, value, status, group) {
                if (this.MSB !== undefined) {
                    value = (this.MSB << 7) + value;
                }
                var change = value - this.valueAtLastEffectSwitch;
                if (Math.abs(change) >= this.changeThreshold
                    // this.valueAtLastEffectSwitch can be undefined if
                    // shift was pressed before the first MIDI value was received.
                    || this.valueAtLastEffectSwitch === undefined) {
                    var effectGroup = '[EffectRack1_EffectUnit' +
                                       eu.currentUnitNumber + '_Effect' +
                                       this.number + ']';
                    engine.setValue(effectGroup, 'effect_selector', change);
                    this.valueAtLastEffectSwitch = value;
                }

                this.previousValueReceived = value;
            };
        },
        outKey: "focused_effect",
        connect: function () {
            this.connections[0] = engine.makeConnection(eu.group, "focused_effect",
                                                        this.onFocusChange);
        },
        disconnect: function () {
            engine.softTakeoverIgnoreNextValue(this.group, this.inKey);
            this.connections[0].disconnect();
        },
        trigger: function () {
            this.connections[0].trigger();
        },
        onFocusChange: function (value, group, control) {
            if (value === 0) {
                this.group = '[EffectRack1_EffectUnit' +
                              eu.currentUnitNumber + '_Effect' +
                              this.number + ']';
                this.inKey = 'meta';
            } else {
                this.group = '[EffectRack1_EffectUnit' + eu.currentUnitNumber +
                              '_Effect' + value + ']';
                this.inKey = 'parameter' + this.number;
            }
            engine.softTakeoverIgnoreNextValue(this.group, this.inKey);
        },
    });

    this.EffectEnableButton = function (number) {
        this.number = number;
        this.group = '[EffectRack1_EffectUnit' + eu.currentUnitNumber +
                      '_Effect' + this.number + ']';
        components.Button.call(this);
    };
    this.EffectEnableButton.prototype = new components.Button({
        type: components.Button.prototype.types.powerWindow,
        // NOTE: This function is only connected when not in focus choosing mode.
        onFocusChange: function (value, group, control) {
            if (value === 0) {
                if (colors !== undefined) {
                    this.color = colors.unfocused;
                }
                this.group = '[EffectRack1_EffectUnit' +
                              eu.currentUnitNumber + '_Effect' +
                              this.number + ']';
                this.inKey = 'enabled';
                this.outKey = 'enabled';
            } else {
                if (colors !== undefined) {
                    this.color = colors.focused;
                }
                this.group = '[EffectRack1_EffectUnit' + eu.currentUnitNumber +
                             '_Effect' + value + ']';
                this.inKey = 'button_parameter' + this.number;
                this.outKey = 'button_parameter' + this.number;
            }
        },
        stopEffectFocusChooseMode: function () {
            this.type = components.Button.prototype.types.powerWindow;
            this.input = function (channel, control, value, status, group) {
                components.Button.prototype.input.apply(this, arguments);
                this.trigger()
            }
            this.output = components.Button.prototype.output;
            if (colors !== undefined) {
                this.color = colors.unfocused;
            }

            this.connect = function () {
                this.connections[0] = engine.makeConnection(eu.group, "focused_effect",
                                                            this.onFocusChange);
                // this.onFocusChange sets this.group and this.outKey, so trigger it
                // before making the connection for LED output
                this.connections[0].trigger();
                this.connections[1] = engine.makeConnection(this.group, this.outKey, this.output);
            };

            this.unshift = function () {
                this.disconnect();
                this.connect();
                this.trigger();
            };
            this.shift = function () {
                this.group = '[EffectRack1_EffectUnit' +
                              eu.currentUnitNumber + '_Effect' +
                              this.number + ']';
                this.inKey = 'enabled';
            };
            if (this.isShifted) {
                this.shift();
            }
        },
        startEffectFocusChooseMode: function () {
            if (colors !== undefined) {
                this.color = colors.focusChooseMode;
            }
            this.input = function (channel, control, value, status, group) {
                if (this.isPress(channel, control, value, status)) {
                    if (engine.getValue(eu.group, "focused_effect") === this.number) {
                        // unfocus and make knobs control metaknobs
                        engine.setValue(eu.group, "focused_effect", 0);
                    } else {
                        // focus this effect
                        engine.setValue(eu.group, "focused_effect", this.number);
                    }
                }
                this.trigger()
            };
            this.output = function (value, group, control) {
                this.send((value === this.number) ? this.on : this.off);
            };
            this.connect = function () {
                // Outside of focus choose mode, the this.connections array
                // has two members. Connections can be triggered when they
                // are disconnected, so overwrite the whole array here instead
                // of assigning to this.connections[0] to avoid
                // Component.prototype.trigger() triggering the disconnected connection.
                this.connections = [engine.makeConnection(eu.group,
                                                          "focused_effect",
                                                          this.output)];
            };
        },
    });

    this.knobs = new components.ComponentContainer();
    this.enableButtons = new components.ComponentContainer();
    for (var n = 1; n <= 3; n++) {
        this.knobs[n] = new this.EffectUnitKnob(n);
        this.enableButtons[n] = new this.EffectEnableButton(n);
    }

    this.effectFocusButton = new components.Button({
        group: this.group,
        longPressed: false,
        longPressTimer: 0,
        pressedWhenParametersHidden: false,
        previouslyFocusedEffect: 0,
        startEffectFocusChooseMode: function () {
            if (colors !== undefined) {
                this.color = colors.focusChooseMode;
            }
            this.send(this.on);
            eu.focusChooseModeActive = true;
            eu.enableButtons.reconnectComponents(function (button) {
                button.startEffectFocusChooseMode();
            });
        },
        setColor: function () {
            if (colors !== undefined) {
                if (engine.getValue(this.group, 'focused_effect') === 0) {
                    this.color = colors.unfocused;
                } else {
                    this.color = colors.focused;
                }
            }
        },
        unshift: function () {
            this.input = function (channel, control, value, status, group) {
                var showParameters = engine.getValue(this.group, "show_parameters");
                if (this.isPress(channel, control, value, status)) {
                    this.longPressTimer = engine.beginTimer(this.longPressTimeout,
                                                  this.startEffectFocusChooseMode,
                                                  true);
                    if (!showParameters) {
                        if (!allowFocusWhenParametersHidden) {
                            engine.setValue(this.group, "show_parameters", 1);
                            // eu.onShowParametersChange will refocus the
                            // previously focused effect and show focus in skin
                        }
                        this.pressedWhenParametersHidden = true;
                    }
                } else {
                    if (this.longPressTimer) {
                        engine.stopTimer(this.longPressTimer);
                    }

                    if (eu.focusChooseModeActive) {
                        this.setColor();
                        this.trigger();
                        eu.enableButtons.reconnectComponents(function (button) {
                            button.stopEffectFocusChooseMode();
                        });
                        eu.focusChooseModeActive = false;
                    } else {
                        if (!showParameters && allowFocusWhenParametersHidden) {
                              engine.setValue(this.group, "show_parameters", 1);
                        } else if (showParameters && !this.pressedWhenParametersHidden) {
                              engine.setValue(this.group, "show_parameters", 0);
                              // eu.onShowParametersChange will save the focused effect,
                              // unfocus, and hide focus buttons in skin
                        }
                    }
                    this.pressedWhenParametersHidden = false;
                }
            };
        },
        shift: function () {
            this.input = function (channel, control, value, status, group) {
                if (this.isPress(channel, control, value, status)) {
                    eu.toggle();
                }
            };
        },
        outKey: 'focused_effect',
        output: function (value, group, control) {
            this.send((value > 0) ? this.on : this.off);
        },
        outConnect: false,
    });
    this.effectFocusButton.setColor();

    this.init = function () {
        this.knobs.reconnectComponents();
        this.enableButtons.reconnectComponents(function (button) {
            button.stopEffectFocusChooseMode();
        });
        this.effectFocusButton.connect();
        this.effectFocusButton.trigger();

        this.enableOnChannelButtons.forEachComponent(function (button) {
            if (button.midi !== undefined) {
                button.disconnect();
                button.connect();
                button.trigger();
            }
        });

        this.forEachComponent(function (component) {
            if (component.group === undefined) {
                component.group = eu.group;
            }
        });

        this.hasInitialized = true;
    };
};
DJ505.EffectUnit.prototype = new components.ComponentContainer();

//////////////////////////////
// Sampler.                 //
//////////////////////////////

DJ505.Sampler = function () {
    components.ComponentContainer.call(this);

    this.button = [];

    var sampler_button_send = function (value) {
        var isLeftDeck = this.number <= 8;
        var channel = isLeftDeck ? 0x94 : 0x95;
        this.midi = [channel, 0x14 + this.number - (isLeftDeck ? 0 : 8)];
        components.SamplerButton.prototype.send.call(this, value);
        this.midi = [channel + 2, 0x14 + this.number - (isLeftDeck ? 0 : 8)];
        components.SamplerButton.prototype.send.call(this, value);
    };

    for (var i=1; i<=16; i++) {
        this.button[i] = new components.SamplerButton({
            sendShifted: false,
            shiftControl: true,
            shiftOffset: 8,
            number: i
        });

        this.button[i].send = sampler_button_send;
    }

    this.level = new components.Pot({
        inValueScale: function (value) {
            // FIXME: The sampler gain knob has a dead zone and appears to scale
            // non-linearly.
            return components.Pot.prototype.inValueScale.call(this, value) * 4;
        },
        input: function (channel, control, value, status, group) {
            if (!DJ505.bindSamplerControls) {
                return;
            }
            for (var i=1; i<=16; i++) {
                var sampler_group = '[Sampler' + i + ']';
                engine.setValue(sampler_group, 'pregain', this.inValueScale(value));
            }
        }
    });

    this.pfl = new components.Button({
        sampler: this,
        midi: [0x9f, 0x1d],
        connect: function () {
            if (!DJ505.bindSamplerControls) {
                return;
            }
            components.Button.prototype.connect.call(this);
            // Ensure a consistent state between mixxx and device.
            for (var i=1; i<=16; i++) {
                var sampler_group = '[Sampler' + i + ']';
                engine.setValue(sampler_group, 'pfl', false);
            }
            this.send(0);
        },
        input: function (channel, control, value, status, group) {
            if (!value || !DJ505.bindSamplerControls) {
                return;
            }
            for (var i=1; i<=16; i++) {
                var sampler_group = '[Sampler' + i + ']';
                script.toggleControl(sampler_group, 'pfl');
            }
        }
    });
};

DJ505.Sampler.prototype = Object.create(components.ComponentContainer.prototype);


////////////////////////
// Custom components. //
////////////////////////
DJ505.FlashingButton = function () {
    components.Button.call(this);
    this.flashFreq = 50;
};

DJ505.FlashingButton.prototype = Object.create(components.Button.prototype);

DJ505.FlashingButton.prototype.flash = function (cycles) {
    if (cycles == 0) {
        // Reset to correct value after flashing phase ends.
        this.trigger();
        return;
    }

    if (cycles === undefined) {
        cycles = 10;
    }

    var value = cycles % 2 == 0 ? 0x7f : 0;
    this.send(value);

    engine.beginTimer(
        this.flashFreq,
        function () {
            var value = value ? 0 : 0x7f;
            this.send(value);
            this.flash(cycles - 1);
        },
        true
    );
};

DJ505.SyncButton = function (options) {
    components.SyncButton.call(this, options);
    this.doubleTapTimeout = 500;
};

DJ505.SyncButton.prototype = Object.create(components.SyncButton.prototype);

DJ505.SyncButton.prototype.connect = function () {
    this.connections = [
        engine.makeConnection(this.group, 'sync_enabled', this.output),
        engine.makeConnection(this.group, 'quantize', this.output)
    ];
    this.deck = script.deckFromGroup(this.group);
    this.midi_enable = [0x90 + this.deck - 1, 0x02];
    this.midi_disable = [0x90 + this.deck - 1, 0x03];
};

DJ505.SyncButton.prototype.send = function (value) {
    var midi_ = value ? this.midi_enable : this.midi_disable;
    midi.sendShortMsg(midi_[0], midi_[1], 0x7f);
};

DJ505.SyncButton.prototype.output = function (value, group, control) {
    // Multiplex between several keys without forcing a reconnect.
    if (control != this.outKey) {
        return;
    }
    this.send(value);
};

DJ505.SyncButton.prototype.unshift = function () {
    this.inKey = 'sync_enabled';
    this.outKey = 'sync_enabled';
    this.trigger();
    this.input = function (channel, control, value, status, group) {
        if (this.isPress(channel, control, value, status)) {
            if (this.isDoubleTap) {                               // Double tap.
                var fileBPM = engine.getValue(this.group, 'file_bpm');
                engine.setValue(this.group, 'bpm', fileBPM);
                return;
            }                                               // Else: Single tap.

            var syncEnabled = engine.getValue(this.group, 'sync_enabled');

            if (!syncEnabled) {                // Single tap when sync disabled.
                engine.setValue(this.group, 'beatsync', 1);
                this.longPressTimer = engine.beginTimer(
                    this.longPressTimeout,
                    function () {
                        engine.setValue(this.group, 'sync_enabled', 1);
                        this.longPressTimer = null;
                    },
                    true
                );
                // For the next call.
                this.isDoubleTap = true;
                this.doubleTapTimer = engine.beginTimer(
                    this.doubleTapTimeout,
                    function () { this.isDoubleTap = false; },
                    true
                );
                return;
            }                                          // Else: Sync is enabled.

            engine.setValue(this.group, 'sync_enabled', 0);
            return;
        }                                            // Else: On button release.

        if (this.longPressTimer) {
            engine.stopTimer(this.longPressTimer);
            this.longPressTimer = null;
        }

        // Work-around button LED disabling itself on release.
        this.trigger();
    };
};


DJ505.SyncButton.prototype.shift = function () {
    this.outKey = 'quantize';
    this.inKey = 'quantize';
    this.trigger();
    this.input = function (channel, control, value, status, group) {
        if (value) {
            this.inToggle();
        } else {
            // Work-around LED self-disable issue.
            this.trigger();
        }
    };
};


DJ505.HotcueButton = function () {
    components.HotcueButton.apply(this, arguments);
    this.sendShifted = true;
    this.shiftControl = true;
    this.shiftOffset = 8;
};

DJ505.HotcueButton.prototype = Object.create(components.HotcueButton.prototype);

DJ505.HotcueButton.prototype.connect = function () {
    var deck = script.deckFromGroup(this.group);
    this.midi = [0x94 + deck - 1, this.number];
    components.HotcueButton.prototype.connect.call(this);
};

DJ505.HotcueButton.prototype.unshift = function () {
    this.inKey = 'hotcue_' + this.number + '_activate';
    this.input = function (channel, control, value, status, group) {
        components.HotcueButton.prototype.input.apply(this, arguments);
    };
};

DJ505.HotcueButton.prototype.shift = function ()  {
    this.input = function (channel, control, value, status, group) {
        if (!value) {
            return;
        }
        script.triggerControl(this.group, 'hotcue_' + this.number + '_clear');
        if (engine.getValue(this.group, 'play')) {
            script.triggerControl(this.group, 'hotcue_' + this.number + '_set');
        }
    };
};

DJ505.DeckButton = function () {
    components.Button.apply(this, arguments);
};

DJ505.DeckButton.prototype = Object.create(components.Button.prototype);

DJ505.DeckButton.prototype.connect = function () {
    var deck = script.deckFromGroup(this.group);
    this.midi = [0x94 + deck - 1, this.cc];
    components.Button.prototype.connect.apply(this, arguments);
};

DJ505.SlipModeButton = function () {
    components.Button.apply(this, arguments);
    this.inKey = 'slip_enabled';
    this.outKey = 'slip_enabled';
    this.doubleTapTimeout = 500;
};

DJ505.SlipModeButton.prototype = Object.create(components.Button.prototype);

DJ505.SlipModeButton.prototype.connect = function () {
    var deck = script.deckFromGroup(this.group);
    this.midi = [0x90 + deck - 1, 0x7];
    components.Button.prototype.connect.call(this);
};

DJ505.SlipModeButton.prototype.input = function (channel, control, value, status, group) {
    if (value) {                                                // Button press.
        this.inSetValue(true);
        return;
    }                                                   // Else: button release.

    if (!this.doubleTapped) {
        this.inSetValue(false);
    }

    // Work-around LED disabling itself on release.
    this.trigger();

    this.doubleTapped = true;

    if (this.doubleTapTimer) {
        engine.stopTimer(this.doubleTapTimer);
        this.doubleTapTimer = null;
    }

    this.doubleTapTimer = engine.beginTimer(
        this.doubleTapTimeout,
        function () {
            this.doubleTapped = false;
            this.doubleTapTimer = null;
        },
        true
    );
};


DJ505.KeylockButton = function (paramButtons) {
    components.Button.call(this, {
        sendShifted: true,
        shiftChannel: true,
        shiftOffset: 2,
        outKey: 'keylock',
        currentRangeIndex: 0,
        doubleTapTimeout: 500,
        paramPlusMinus: paramButtons
    });
};

DJ505.KeylockButton.prototype = Object.create(components.Button.prototype);

DJ505.KeylockButton.prototype.unshift = function () {
    if (this.deck) {
        this.midi = [0x90 + this.deck - 1, 0x0D];
        this.trigger();
    }
    this.input = function (channel, control, value, status, group) {
        if (value) {                                            // Button press.

            this.longPressTimer = engine.beginTimer(
                this.longPressTimeout,
                function () {
                    this.paramPlusMinus.songKeyMode(true);
                    this.is_held = true;
                },
                true
            );

            return;
        }                                               // Else: Button release.

        // The DJ-505 disables the keylock LED when the button is pressed
        // shifted. Restore the LED when shift is released.
        this.trigger();

        if (this.longPressTimer) {
            engine.stopTimer(this.longPressTimer);
            this.longPressTimer = null;
        }

        if (this.is_held) {                               // Release after hold.
            this.paramPlusMinus.songKeyMode(false);
            this.is_held = false;
            return;
        }                                      // Else: release after short tap.

        script.toggleControl(this.group, this.outKey);
    };
    this.inKey = 'keylock';
};

DJ505.KeylockButton.prototype.connect = function () {
    this.deck = script.deckFromGroup(this.group);
    components.Button.prototype.connect.call(this);
    // components.Component automatically unshifts upon component instanciation.
    // However, we need to trigger side-effects upon unshifting (button LED
    // issue). Hence, we need to unshift again after we are connected.
    this.unshift();
};

DJ505.KeylockButton.prototype.shift = function () {
    this.midi = [0x90 + this.deck - 1, 0x0E];
    this.send(0);
    this.inKey = 'rateRange';
    this.type = undefined;
    this.input = function (channel, control, value, status, group) {
        if (this.isPress(channel, control, value, status)) {
            this.send(0x7f);
            this.currentRangeIndex++;
            if (this.currentRangeIndex >= DJ505.tempoRange.length) {
                this.currentRangeIndex = 0;
            }
            this.inSetValue(DJ505.tempoRange[this.currentRangeIndex]);
            return;
        }
        this.send(0);
    };
};


DJ505.ParamButtons = function () {
    components.Button.apply(this, arguments);
    this.isSongKeyMode = false;
    this.active = [false, false];
};

DJ505.ParamButtons.prototype = Object.create(components.Button.prototype);

DJ505.ParamButtons.prototype.setLEDs = function (plusValue, minusValue) {
    var deck = script.deckFromGroup(this.group);
    var channel = 0x94 + deck - 1;
    [0, 2, 4, 8, 10].forEach(
        function (offSet) {
            midi.sendShortMsg(channel, 0x41 + offSet, plusValue);
            midi.sendShortMsg(channel, 0x42 + offSet, minusValue);
        }
    );
};

DJ505.ParamButtons.prototype.connect = function () {
    components.Button.prototype.connect.call(this);
    var keyConnection = engine.makeConnection(this.group, 'pitch_adjust', this.output);
    this.connections.push(keyConnection);
};

DJ505.ParamButtons.prototype.output = function (value, group, control) {
    if (!this.isSongKeyMode) {
        return;
    }

    if (this.isSongKeyMode && control != 'pitch_adjust') {
        return;
    }

    var deck = script.deckFromGroup(this.group);

    // The control value returned has floating point jitter, so 0 can be
    // 0.00…1 and 1 can be 0.99.
    if (value < 0.5 && value > -0.5) {
        this.setLEDs(0, 0);
    }
    if (value < -0.5) {
        this.setLEDs(0x7f, 0);
        return;
    }
    if (value > 0.5) {
        this.setLEDs(0, 0x7f);
    }
};

DJ505.ParamButtons.prototype.songKeyMode = function (toggle) {
    this.isSongKeyMode = toggle;
    if(toggle) {
        this.trigger();
    } else {
        this.setLEDs(0, 0);
    }
};

DJ505.ParamButtons.prototype.input = function (channel, control, value, status, group) {

    var isPlus = control % 2 == 0;

    this.active[isPlus ? 0 : 1] = Boolean(value);

    // FIXME: This make the LEDs light up on press, but doesn’t properly
    // connect the output controls, so the buttons won’t light when
    // manipulated from within the GUI.
    var deck = script.deckFromGroup(group);
    midi.sendShortMsg(0x94 + deck - 1, control, value);

    if (!value) {
        // Work-around LED self-reset on release.
        this.trigger();
        return;
    }

    if (this.active.every(Boolean)) {
        script.triggerControl(group, 'reset_key');
        return;
    }

    if (this.isSongKeyMode) {
        var adjust = engine.getValue(group, 'pitch_adjust');
        var new_adjust = isPlus ? Math.min(7, adjust + 1) : Math.max(-7, adjust - 1);
        engine.setValue(group, 'pitch_adjust', new_adjust);
        return;
    }

    var beatjumpSize = engine.getValue(group, 'beatjump_size');
    var beatloopSize = engine.getValue(group, 'beatloop_size');

    switch (control) {
    case 0x43:                                              // Hot-Cue mode.
    case 0x44:
        script.triggerControl(group, isPlus ? 'beatjump_forward' : 'beatjump_backward');
        break;
    case 0x4B:                                    // Hot-Cue mode (shifted).
    case 0x4C:
        engine.setValue(group, 'beatjump_size', isPlus ? beatjumpSize*2 : beatjumpSize/2);
        break;
    }
};

DJ505.PadSection = function (deck) {
    components.ComponentContainer.call(this);

    this.state = "hotcue";
    this.hotcueButton = [];
    this.samplerButton = [];

    for (var i = 1; i <= 8; i++) {
        this.hotcueButton[i] = new DJ505.HotcueButton({number: i});
        this.samplerButton[i] = new components.SamplerButton({
            sendShifted: false,
            shiftControl: true,
            shiftOffset: 8,
            number: i,
        });
    }

    this.paramPlusMinus = new DJ505.ParamButtons();
};

DJ505.PadSection.prototype = Object.create(components.ComponentContainer.prototype);

DJ505.PadSection.prototype.setState = function (channel, control, value, status, group) {
    switch (control) {
    case 0x00: // [HOT CUE]
        this.state = "hotcue";
        break;
    case 0x02: // [HOT CUE] (press twice)
        this.state = "flip";
        break;
    case 0x03: // [SHIFT] + [HOT CUE]
        this.state = "cueloop";
        break;
    case 0x08: // [ROLL]
        this.state = "roll";
        break;
    case 0x0D: // [ROLL] (press twice)
        this.state = "loop";
        break;
    case 0x09: // [SHIFT] + [ROLL]
        this.state = "slicer";
        break;
    case 0x0A: // [SHIFT] + [ROLL] (press twice)
        this.state = "slicerloop";
        break;
    case 0x04: // [TR]
        this.state = "tr";
        break;
    case 0x06: // [TR] (press twice)
        this.state = "trvelocity";
        break;
    case 0x05: // [SHIFT] + [TR]
        this.state = "pattern";
        break;
    case 0x0B: // [SAMPLER]
        this.state = "sampler";
        break;
    case 0x0F: // [SAMPLER] (press twice)
        this.state = "pitchplay";
        break;
    case 0x0C: // [SHIFT] + [SAMPLER]
        this.state = "velocitysampler";
        break;
    }
};

DJ505.PadSection.prototype.padPressed = function (channel, control, value, status, group) {
    var i = control - ((control > 0x1B) ? 0x1B : 0x13);
    switch (this.state) {
    case "hotcue":
        this.hotcueButton[i].input(channel, control, value, status, group);
        break;
    case "sampler":
        this.samplerButton[i].input(channel, control, value, status, group);
        break;
    }
};
