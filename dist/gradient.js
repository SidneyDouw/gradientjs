(function(root,factory){if(typeof define==='function'&&define.amd){define([],factory)}else{root.Gradient=factory()}}(this,function(){
/**
 * @license almond 0.3.3 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/almond/LICENSE
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part, normalizedBaseParts,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name) {
            name = name.split('/');
            lastIndex = name.length - 1;

            // If wanting node ID compatibility, strip .js from end
            // of IDs. Have to do this here, and not in nameToUrl
            // because node allows either .js or non .js to map
            // to same file.
            if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
            }

            // Starts with a '.' so need the baseName
            if (name[0].charAt(0) === '.' && baseParts) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that 'directory' and not name of the baseName's
                //module. For instance, baseName of 'one/two/three', maps to
                //'one/two/three.js', but we want the directory, 'one/two' for
                //this normalization.
                normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            //start trimDots
            for (i = 0; i < name.length; i++) {
                part = name[i];
                if (part === '.') {
                    name.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && name[2] === '..') || name[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        name.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
            //end trimDots

            name = name.join('/');
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    //Creates a parts array for a relName where first part is plugin ID,
    //second part is resource ID. Assumes relName has already been normalized.
    function makeRelParts(relName) {
        return relName ? splitPrefix(relName) : [];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relParts) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0],
            relResourceName = relParts[1];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relResourceName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relResourceName));
            } else {
                name = normalize(name, relResourceName);
            }
        } else {
            name = normalize(name, relResourceName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i, relParts,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;
        relParts = makeRelParts(relName);

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relParts);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, makeRelParts(callback)).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

/**
 * jscolor - JavaScript Color Picker
 *
 * @link    http://jscolor.com
 * @license For open source use: GPLv3
 *          For commercial use: JSColor Commercial License
 * @author  Jan Odvarko
 * @version 2.0.4
 *
 * See usage examples at http://jscolor.com/examples/
 */


define('jscolor',[], function() {

var jsc = {


	register : function () {
		jsc.attachDOMReadyEvent(jsc.init);
		jsc.attachEvent(document, 'mousedown', jsc.onDocumentMouseDown);
		jsc.attachEvent(document, 'touchstart', jsc.onDocumentTouchStart);
		jsc.attachEvent(window, 'resize', jsc.onWindowResize);
	},


	init : function () {
		if (jsc.jscolor.lookupClass) {
			jsc.jscolor.installByClassName(jsc.jscolor.lookupClass);
		}
	},


	tryInstallOnElements : function (elms, className) {
		var matchClass = new RegExp('(^|\\s)(' + className + ')(\\s*(\\{[^}]*\\})|\\s|$)', 'i');

		for (var i = 0; i < elms.length; i += 1) {
			if (elms[i].type !== undefined && elms[i].type.toLowerCase() == 'color') {
				if (jsc.isColorAttrSupported) {
					// skip inputs of type 'color' if supported by the browser
					continue;
				}
			}
			var m;
			if (!elms[i].jscolor && elms[i].className && (m = elms[i].className.match(matchClass))) {
				var targetElm = elms[i];
				var optsStr = null;

				var dataOptions = jsc.getDataAttr(targetElm, 'jscolor');
				if (dataOptions !== null) {
					optsStr = dataOptions;
				} else if (m[4]) {
					optsStr = m[4];
				}

				var opts = {};
				if (optsStr) {
					try {
						opts = (new Function ('return (' + optsStr + ')'))();
					} catch(eParseError) {
						jsc.warn('Error parsing jscolor options: ' + eParseError + ':\n' + optsStr);
					}
				}
				targetElm.jscolor = new jsc.jscolor(targetElm, opts);
			}
		}
	},


	isColorAttrSupported : (function () {
		var elm = document.createElement('input');
		if (elm.setAttribute) {
			elm.setAttribute('type', 'color');
			if (elm.type.toLowerCase() == 'color') {
				return true;
			}
		}
		return false;
	})(),


	isCanvasSupported : (function () {
		var elm = document.createElement('canvas');
		return !!(elm.getContext && elm.getContext('2d'));
	})(),


	fetchElement : function (mixed) {
		return typeof mixed === 'string' ? document.getElementById(mixed) : mixed;
	},


	isElementType : function (elm, type) {
		return elm.nodeName.toLowerCase() === type.toLowerCase();
	},


	getDataAttr : function (el, name) {
		var attrName = 'data-' + name;
		var attrValue = el.getAttribute(attrName);
		if (attrValue !== null) {
			return attrValue;
		}
		return null;
	},


	attachEvent : function (el, evnt, func) {
		if (el.addEventListener) {
			el.addEventListener(evnt, func, false);
		} else if (el.attachEvent) {
			el.attachEvent('on' + evnt, func);
		}
	},


	detachEvent : function (el, evnt, func) {
		if (el.removeEventListener) {
			el.removeEventListener(evnt, func, false);
		} else if (el.detachEvent) {
			el.detachEvent('on' + evnt, func);
		}
	},


	_attachedGroupEvents : {},


	attachGroupEvent : function (groupName, el, evnt, func) {
		if (!jsc._attachedGroupEvents.hasOwnProperty(groupName)) {
			jsc._attachedGroupEvents[groupName] = [];
		}
		jsc._attachedGroupEvents[groupName].push([el, evnt, func]);
		jsc.attachEvent(el, evnt, func);
	},


	detachGroupEvents : function (groupName) {
		if (jsc._attachedGroupEvents.hasOwnProperty(groupName)) {
			for (var i = 0; i < jsc._attachedGroupEvents[groupName].length; i += 1) {
				var evt = jsc._attachedGroupEvents[groupName][i];
				jsc.detachEvent(evt[0], evt[1], evt[2]);
			}
			delete jsc._attachedGroupEvents[groupName];
		}
	},


	attachDOMReadyEvent : function (func) {
		var fired = false;
		var fireOnce = function () {
			if (!fired) {
				fired = true;
				func();
			}
		};

		if (document.readyState === 'complete') {
			setTimeout(fireOnce, 1); // async
			return;
		}

		if (document.addEventListener) {
			document.addEventListener('DOMContentLoaded', fireOnce, false);

			// Fallback
			window.addEventListener('load', fireOnce, false);

		} else if (document.attachEvent) {
			// IE
			document.attachEvent('onreadystatechange', function () {
				if (document.readyState === 'complete') {
					document.detachEvent('onreadystatechange', arguments.callee);
					fireOnce();
				}
			})

			// Fallback
			window.attachEvent('onload', fireOnce);

			// IE7/8
			if (document.documentElement.doScroll && window == window.top) {
				var tryScroll = function () {
					if (!document.body) { return; }
					try {
						document.documentElement.doScroll('left');
						fireOnce();
					} catch (e) {
						setTimeout(tryScroll, 1);
					}
				};
				tryScroll();
			}
		}
	},


	warn : function (msg) {
		if (window.console && window.console.warn) {
			window.console.warn(msg);
		}
	},


	preventDefault : function (e) {
		if (e.preventDefault) { e.preventDefault(); }
		e.returnValue = false;
	},


	captureTarget : function (target) {
		// IE
		if (target.setCapture) {
			jsc._capturedTarget = target;
			jsc._capturedTarget.setCapture();
		}
	},


	releaseTarget : function () {
		// IE
		if (jsc._capturedTarget) {
			jsc._capturedTarget.releaseCapture();
			jsc._capturedTarget = null;
		}
	},


	fireEvent : function (el, evnt) {
		if (!el) {
			return;
		}
		if (document.createEvent) {
			var ev = document.createEvent('HTMLEvents');
			ev.initEvent(evnt, true, true);
			el.dispatchEvent(ev);
		} else if (document.createEventObject) {
			var ev = document.createEventObject();
			el.fireEvent('on' + evnt, ev);
		} else if (el['on' + evnt]) { // alternatively use the traditional event model
			el['on' + evnt]();
		}
	},


	classNameToList : function (className) {
		return className.replace(/^\s+|\s+$/g, '').split(/\s+/);
	},


	// The className parameter (str) can only contain a single class name
	hasClass : function (elm, className) {
		if (!className) {
			return false;
		}
		return -1 != (' ' + elm.className.replace(/\s+/g, ' ') + ' ').indexOf(' ' + className + ' ');
	},


	// The className parameter (str) can contain multiple class names separated by whitespace
	setClass : function (elm, className) {
		var classList = jsc.classNameToList(className);
		for (var i = 0; i < classList.length; i += 1) {
			if (!jsc.hasClass(elm, classList[i])) {
				elm.className += (elm.className ? ' ' : '') + classList[i];
			}
		}
	},


	// The className parameter (str) can contain multiple class names separated by whitespace
	unsetClass : function (elm, className) {
		var classList = jsc.classNameToList(className);
		for (var i = 0; i < classList.length; i += 1) {
			var repl = new RegExp(
				'^\\s*' + classList[i] + '\\s*|' +
				'\\s*' + classList[i] + '\\s*$|' +
				'\\s+' + classList[i] + '(\\s+)',
				'g'
			);
			elm.className = elm.className.replace(repl, '$1');
		}
	},


	getStyle : function (elm) {
		return window.getComputedStyle ? window.getComputedStyle(elm) : elm.currentStyle;
	},


	setStyle : (function () {
		var helper = document.createElement('div');
		var getSupportedProp = function (names) {
			for (var i = 0; i < names.length; i += 1) {
				if (names[i] in helper.style) {
					return names[i];
				}
			}
		};
		var props = {
			borderRadius: getSupportedProp(['borderRadius', 'MozBorderRadius', 'webkitBorderRadius']),
			boxShadow: getSupportedProp(['boxShadow', 'MozBoxShadow', 'webkitBoxShadow'])
		};
		return function (elm, prop, value) {
			switch (prop.toLowerCase()) {
			case 'opacity':
				var alphaOpacity = Math.round(parseFloat(value) * 100);
				elm.style.opacity = value;
				elm.style.filter = 'alpha(opacity=' + alphaOpacity + ')';
				break;
			default:
				elm.style[props[prop]] = value;
				break;
			}
		};
	})(),


	setBorderRadius : function (elm, value) {
		jsc.setStyle(elm, 'borderRadius', value || '0');
	},


	setBoxShadow : function (elm, value) {
		jsc.setStyle(elm, 'boxShadow', value || 'none');
	},


	getElementPos : function (e, relativeToViewport) {
		var x=0, y=0;
		var rect = e.getBoundingClientRect();
		x = rect.left;
		y = rect.top;
		if (!relativeToViewport) {
			var viewPos = jsc.getViewPos();
			x += viewPos[0];
			y += viewPos[1];
		}
		return [x, y];
	},


	getElementSize : function (e) {
		return [e.offsetWidth, e.offsetHeight];
	},


	// get pointer's X/Y coordinates relative to viewport
	getAbsPointerPos : function (e) {
		if (!e) { e = window.event; }
		var x = 0, y = 0;
		if (typeof e.changedTouches !== 'undefined' && e.changedTouches.length) {
			// touch devices
			x = e.changedTouches[0].clientX;
			y = e.changedTouches[0].clientY;
		} else if (typeof e.clientX === 'number') {
			x = e.clientX;
			y = e.clientY;
		}
		return { x: x, y: y };
	},


	// get pointer's X/Y coordinates relative to target element
	getRelPointerPos : function (e) {
		if (!e) { e = window.event; }
		var target = e.target || e.srcElement;
		var targetRect = target.getBoundingClientRect();

		var x = 0, y = 0;

		var clientX = 0, clientY = 0;
		if (typeof e.changedTouches !== 'undefined' && e.changedTouches.length) {
			// touch devices
			clientX = e.changedTouches[0].clientX;
			clientY = e.changedTouches[0].clientY;
		} else if (typeof e.clientX === 'number') {
			clientX = e.clientX;
			clientY = e.clientY;
		}

		x = clientX - targetRect.left;
		y = clientY - targetRect.top;
		return { x: x, y: y };
	},


	getViewPos : function () {
		var doc = document.documentElement;
		return [
			(window.pageXOffset || doc.scrollLeft) - (doc.clientLeft || 0),
			(window.pageYOffset || doc.scrollTop) - (doc.clientTop || 0)
		];
	},


	getViewSize : function () {
		var doc = document.documentElement;
		return [
			(window.innerWidth || doc.clientWidth),
			(window.innerHeight || doc.clientHeight),
		];
	},


	redrawPosition : function () {

		if (jsc.picker && jsc.picker.owner) {
			var thisObj = jsc.picker.owner;

			var tp, vp;

			if (thisObj.fixed) {
				// Fixed elements are positioned relative to viewport,
				// therefore we can ignore the scroll offset
				tp = jsc.getElementPos(thisObj.targetElement, true); // target pos
				vp = [0, 0]; // view pos
			} else {
				tp = jsc.getElementPos(thisObj.targetElement); // target pos
				vp = jsc.getViewPos(); // view pos
			}

			var ts = jsc.getElementSize(thisObj.targetElement); // target size
			var vs = jsc.getViewSize(); // view size
			var ps = jsc.getPickerOuterDims(thisObj); // picker size
			var a, b, c;
			switch (thisObj.position.toLowerCase()) {
				case 'left': a=1; b=0; c=-1; break;
				case 'right':a=1; b=0; c=1; break;
				case 'top':  a=0; b=1; c=-1; break;
				default:     a=0; b=1; c=1; break;
			}
			var l = (ts[b]+ps[b])/2;

			// compute picker position
			if (!thisObj.smartPosition) {
				var pp = [
					tp[a],
					tp[b]+ts[b]-l+l*c
				];
			} else {
				var pp = [
					-vp[a]+tp[a]+ps[a] > vs[a] ?
						(-vp[a]+tp[a]+ts[a]/2 > vs[a]/2 && tp[a]+ts[a]-ps[a] >= 0 ? tp[a]+ts[a]-ps[a] : tp[a]) :
						tp[a],
					-vp[b]+tp[b]+ts[b]+ps[b]-l+l*c > vs[b] ?
						(-vp[b]+tp[b]+ts[b]/2 > vs[b]/2 && tp[b]+ts[b]-l-l*c >= 0 ? tp[b]+ts[b]-l-l*c : tp[b]+ts[b]-l+l*c) :
						(tp[b]+ts[b]-l+l*c >= 0 ? tp[b]+ts[b]-l+l*c : tp[b]+ts[b]-l-l*c)
				];
			}

			var x = pp[a];
			var y = pp[b];
			var positionValue = thisObj.fixed ? 'fixed' : 'absolute';
			var contractShadow =
				(pp[0] + ps[0] > tp[0] || pp[0] < tp[0] + ts[0]) &&
				(pp[1] + ps[1] < tp[1] + ts[1]);

			jsc._drawPosition(thisObj, x, y, positionValue, contractShadow);
		}
	},


	_drawPosition : function (thisObj, x, y, positionValue, contractShadow) {
		var vShadow = contractShadow ? 0 : thisObj.shadowBlur; // px

		jsc.picker.wrap.style.position = positionValue;
		jsc.picker.wrap.style.left = x + 'px';
		jsc.picker.wrap.style.top = y + 'px';

		jsc.setBoxShadow(
			jsc.picker.boxS,
			thisObj.shadow ?
				new jsc.BoxShadow(0, vShadow, thisObj.shadowBlur, 0, thisObj.shadowColor) :
				null);
	},


	getPickerDims : function (thisObj) {
		var displaySlider = !!jsc.getSliderComponent(thisObj);
		var dims = [
			2 * thisObj.insetWidth + 2 * thisObj.padding + thisObj.width +
				(displaySlider ? 2 * thisObj.insetWidth + jsc.getPadToSliderPadding(thisObj) + thisObj.sliderSize : 0),
			2 * thisObj.insetWidth + 2 * thisObj.padding + thisObj.height +
				(thisObj.closable ? 2 * thisObj.insetWidth + thisObj.padding + thisObj.buttonHeight : 0)
		];
		return dims;
	},


	getPickerOuterDims : function (thisObj) {
		var dims = jsc.getPickerDims(thisObj);
		return [
			dims[0] + 2 * thisObj.borderWidth,
			dims[1] + 2 * thisObj.borderWidth
		];
	},


	getPadToSliderPadding : function (thisObj) {
		return Math.max(thisObj.padding, 1.5 * (2 * thisObj.pointerBorderWidth + thisObj.pointerThickness));
	},


	getPadYComponent : function (thisObj) {
		switch (thisObj.mode.charAt(1).toLowerCase()) {
			case 'v': return 'v'; break;
		}
		return 's';
	},


	getSliderComponent : function (thisObj) {
		if (thisObj.mode.length > 2) {
			switch (thisObj.mode.charAt(2).toLowerCase()) {
				case 's': return 's'; break;
				case 'v': return 'v'; break;
			}
		}
		return null;
	},


	onDocumentMouseDown : function (e) {
		if (!e) { e = window.event; }
		var target = e.target || e.srcElement;

		if (target._jscLinkedInstance) {
			if (target._jscLinkedInstance.showOnClick) {
				target._jscLinkedInstance.show();
			}
		} else if (target._jscControlName) {
			jsc.onControlPointerStart(e, target, target._jscControlName, 'mouse');
		} else {
			// Mouse is outside the picker controls -> hide the color picker!
			if (jsc.picker && jsc.picker.owner) {
				jsc.picker.owner.hide();
			}
		}
	},


	onDocumentTouchStart : function (e) {
		if (!e) { e = window.event; }
		var target = e.target || e.srcElement;

		if (target._jscLinkedInstance) {
			if (target._jscLinkedInstance.showOnClick) {
				target._jscLinkedInstance.show();
			}
		} else if (target._jscControlName) {
			jsc.onControlPointerStart(e, target, target._jscControlName, 'touch');
		} else {
			if (jsc.picker && jsc.picker.owner) {
				jsc.picker.owner.hide();
			}
		}
	},


	onWindowResize : function (e) {
		jsc.redrawPosition();
	},


	onParentScroll : function (e) {
		// hide the picker when one of the parent elements is scrolled
		if (jsc.picker && jsc.picker.owner) {
			jsc.picker.owner.hide();
		}
	},


	_pointerMoveEvent : {
		mouse: 'mousemove',
		touch: 'touchmove'
	},
	_pointerEndEvent : {
		mouse: 'mouseup',
		touch: 'touchend'
	},


	_pointerOrigin : null,
	_capturedTarget : null,


	onControlPointerStart : function (e, target, controlName, pointerType) {
		var thisObj = target._jscInstance;

		jsc.preventDefault(e);
		jsc.captureTarget(target);

		var registerDragEvents = function (doc, offset) {
			jsc.attachGroupEvent('drag', doc, jsc._pointerMoveEvent[pointerType],
				jsc.onDocumentPointerMove(e, target, controlName, pointerType, offset));
			jsc.attachGroupEvent('drag', doc, jsc._pointerEndEvent[pointerType],
				jsc.onDocumentPointerEnd(e, target, controlName, pointerType));
		};

		registerDragEvents(document, [0, 0]);

		if (window.parent && window.frameElement) {
			var rect = window.frameElement.getBoundingClientRect();
			var ofs = [-rect.left, -rect.top];
			registerDragEvents(window.parent.window.document, ofs);
		}

		var abs = jsc.getAbsPointerPos(e);
		var rel = jsc.getRelPointerPos(e);
		jsc._pointerOrigin = {
			x: abs.x - rel.x,
			y: abs.y - rel.y
		};

		switch (controlName) {
		case 'pad':
			// if the slider is at the bottom, move it up
			switch (jsc.getSliderComponent(thisObj)) {
			case 's': if (thisObj.hsv[1] === 0) { thisObj.fromHSV(null, 100, null); }; break;
			case 'v': if (thisObj.hsv[2] === 0) { thisObj.fromHSV(null, null, 100); }; break;
			}
			jsc.setPad(thisObj, e, 0, 0);
			break;

		case 'sld':
			jsc.setSld(thisObj, e, 0);
			break;
		}

		jsc.dispatchFineChange(thisObj);
	},


	onDocumentPointerMove : function (e, target, controlName, pointerType, offset) {
		return function (e) {
			var thisObj = target._jscInstance;
			switch (controlName) {
			case 'pad':
				if (!e) { e = window.event; }
				jsc.setPad(thisObj, e, offset[0], offset[1]);
				jsc.dispatchFineChange(thisObj);
				break;

			case 'sld':
				if (!e) { e = window.event; }
				jsc.setSld(thisObj, e, offset[1]);
				jsc.dispatchFineChange(thisObj);
				break;
			}
		}
	},


	onDocumentPointerEnd : function (e, target, controlName, pointerType) {
		return function (e) {
			var thisObj = target._jscInstance;
			jsc.detachGroupEvents('drag');
			jsc.releaseTarget();
			// Always dispatch changes after detaching outstanding mouse handlers,
			// in case some user interaction will occur in user's onchange callback
			// that would intrude with current mouse events
			jsc.dispatchChange(thisObj);
		};
	},


	dispatchChange : function (thisObj) {
		if (thisObj.valueElement) {
			if (jsc.isElementType(thisObj.valueElement, 'input')) {
				jsc.fireEvent(thisObj.valueElement, 'change');
			}
		}
	},


	dispatchFineChange : function (thisObj) {
		if (thisObj.onFineChange) {
			var callback;
			if (typeof thisObj.onFineChange === 'string') {
				callback = new Function(thisObj.onFineChange);
			} else {
				callback = thisObj.onFineChange;
			}
			callback.call(thisObj);
		}
	},


	setPad : function (thisObj, e, ofsX, ofsY) {
		var pointerAbs = jsc.getAbsPointerPos(e);
		var x = ofsX + pointerAbs.x - jsc._pointerOrigin.x - thisObj.padding - thisObj.insetWidth;
		var y = ofsY + pointerAbs.y - jsc._pointerOrigin.y - thisObj.padding - thisObj.insetWidth;

		var xVal = x * (360 / (thisObj.width - 1));
		var yVal = 100 - (y * (100 / (thisObj.height - 1)));

		switch (jsc.getPadYComponent(thisObj)) {
		case 's': thisObj.fromHSV(xVal, yVal, null, jsc.leaveSld); break;
		case 'v': thisObj.fromHSV(xVal, null, yVal, jsc.leaveSld); break;
		}
	},


	setSld : function (thisObj, e, ofsY) {
		var pointerAbs = jsc.getAbsPointerPos(e);
		var y = ofsY + pointerAbs.y - jsc._pointerOrigin.y - thisObj.padding - thisObj.insetWidth;

		var yVal = 100 - (y * (100 / (thisObj.height - 1)));

		switch (jsc.getSliderComponent(thisObj)) {
		case 's': thisObj.fromHSV(null, yVal, null, jsc.leavePad); break;
		case 'v': thisObj.fromHSV(null, null, yVal, jsc.leavePad); break;
		}
	},


	_vmlNS : 'jsc_vml_',
	_vmlCSS : 'jsc_vml_css_',
	_vmlReady : false,


	initVML : function () {
		if (!jsc._vmlReady) {
			// init VML namespace
			var doc = document;
			if (!doc.namespaces[jsc._vmlNS]) {
				doc.namespaces.add(jsc._vmlNS, 'urn:schemas-microsoft-com:vml');
			}
			if (!doc.styleSheets[jsc._vmlCSS]) {
				var tags = ['shape', 'shapetype', 'group', 'background', 'path', 'formulas', 'handles', 'fill', 'stroke', 'shadow', 'textbox', 'textpath', 'imagedata', 'line', 'polyline', 'curve', 'rect', 'roundrect', 'oval', 'arc', 'image'];
				var ss = doc.createStyleSheet();
				ss.owningElement.id = jsc._vmlCSS;
				for (var i = 0; i < tags.length; i += 1) {
					ss.addRule(jsc._vmlNS + '\\:' + tags[i], 'behavior:url(#default#VML);');
				}
			}
			jsc._vmlReady = true;
		}
	},


	createPalette : function () {

		var paletteObj = {
			elm: null,
			draw: null
		};

		if (jsc.isCanvasSupported) {
			// Canvas implementation for modern browsers

			var canvas = document.createElement('canvas');
			var ctx = canvas.getContext('2d');

			var drawFunc = function (width, height, type) {
				canvas.width = width;
				canvas.height = height;

				ctx.clearRect(0, 0, canvas.width, canvas.height);

				var hGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
				hGrad.addColorStop(0 / 6, '#F00');
				hGrad.addColorStop(1 / 6, '#FF0');
				hGrad.addColorStop(2 / 6, '#0F0');
				hGrad.addColorStop(3 / 6, '#0FF');
				hGrad.addColorStop(4 / 6, '#00F');
				hGrad.addColorStop(5 / 6, '#F0F');
				hGrad.addColorStop(6 / 6, '#F00');

				ctx.fillStyle = hGrad;
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				var vGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
				switch (type.toLowerCase()) {
				case 's':
					vGrad.addColorStop(0, 'rgba(255,255,255,0)');
					vGrad.addColorStop(1, 'rgba(255,255,255,1)');
					break;
				case 'v':
					vGrad.addColorStop(0, 'rgba(0,0,0,0)');
					vGrad.addColorStop(1, 'rgba(0,0,0,1)');
					break;
				}
				ctx.fillStyle = vGrad;
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			};

			paletteObj.elm = canvas;
			paletteObj.draw = drawFunc;

		} else {
			// VML fallback for IE 7 and 8

			jsc.initVML();

			var vmlContainer = document.createElement('div');
			vmlContainer.style.position = 'relative';
			vmlContainer.style.overflow = 'hidden';

			var hGrad = document.createElement(jsc._vmlNS + ':fill');
			hGrad.type = 'gradient';
			hGrad.method = 'linear';
			hGrad.angle = '90';
			hGrad.colors = '16.67% #F0F, 33.33% #00F, 50% #0FF, 66.67% #0F0, 83.33% #FF0'

			var hRect = document.createElement(jsc._vmlNS + ':rect');
			hRect.style.position = 'absolute';
			hRect.style.left = -1 + 'px';
			hRect.style.top = -1 + 'px';
			hRect.stroked = false;
			hRect.appendChild(hGrad);
			vmlContainer.appendChild(hRect);

			var vGrad = document.createElement(jsc._vmlNS + ':fill');
			vGrad.type = 'gradient';
			vGrad.method = 'linear';
			vGrad.angle = '180';
			vGrad.opacity = '0';

			var vRect = document.createElement(jsc._vmlNS + ':rect');
			vRect.style.position = 'absolute';
			vRect.style.left = -1 + 'px';
			vRect.style.top = -1 + 'px';
			vRect.stroked = false;
			vRect.appendChild(vGrad);
			vmlContainer.appendChild(vRect);

			var drawFunc = function (width, height, type) {
				vmlContainer.style.width = width + 'px';
				vmlContainer.style.height = height + 'px';

				hRect.style.width =
				vRect.style.width =
					(width + 1) + 'px';
				hRect.style.height =
				vRect.style.height =
					(height + 1) + 'px';

				// Colors must be specified during every redraw, otherwise IE won't display
				// a full gradient during a subsequential redraw
				hGrad.color = '#F00';
				hGrad.color2 = '#F00';

				switch (type.toLowerCase()) {
				case 's':
					vGrad.color = vGrad.color2 = '#FFF';
					break;
				case 'v':
					vGrad.color = vGrad.color2 = '#000';
					break;
				}
			};
			
			paletteObj.elm = vmlContainer;
			paletteObj.draw = drawFunc;
		}

		return paletteObj;
	},


	createSliderGradient : function () {

		var sliderObj = {
			elm: null,
			draw: null
		};

		if (jsc.isCanvasSupported) {
			// Canvas implementation for modern browsers

			var canvas = document.createElement('canvas');
			var ctx = canvas.getContext('2d');

			var drawFunc = function (width, height, color1, color2) {
				canvas.width = width;
				canvas.height = height;

				ctx.clearRect(0, 0, canvas.width, canvas.height);

				var grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
				grad.addColorStop(0, color1);
				grad.addColorStop(1, color2);

				ctx.fillStyle = grad;
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			};

			sliderObj.elm = canvas;
			sliderObj.draw = drawFunc;

		} else {
			// VML fallback for IE 7 and 8

			jsc.initVML();

			var vmlContainer = document.createElement('div');
			vmlContainer.style.position = 'relative';
			vmlContainer.style.overflow = 'hidden';

			var grad = document.createElement(jsc._vmlNS + ':fill');
			grad.type = 'gradient';
			grad.method = 'linear';
			grad.angle = '180';

			var rect = document.createElement(jsc._vmlNS + ':rect');
			rect.style.position = 'absolute';
			rect.style.left = -1 + 'px';
			rect.style.top = -1 + 'px';
			rect.stroked = false;
			rect.appendChild(grad);
			vmlContainer.appendChild(rect);

			var drawFunc = function (width, height, color1, color2) {
				vmlContainer.style.width = width + 'px';
				vmlContainer.style.height = height + 'px';

				rect.style.width = (width + 1) + 'px';
				rect.style.height = (height + 1) + 'px';

				grad.color = color1;
				grad.color2 = color2;
			};
			
			sliderObj.elm = vmlContainer;
			sliderObj.draw = drawFunc;
		}

		return sliderObj;
	},


	leaveValue : 1<<0,
	leaveStyle : 1<<1,
	leavePad : 1<<2,
	leaveSld : 1<<3,


	BoxShadow : (function () {
		var BoxShadow = function (hShadow, vShadow, blur, spread, color, inset) {
			this.hShadow = hShadow;
			this.vShadow = vShadow;
			this.blur = blur;
			this.spread = spread;
			this.color = color;
			this.inset = !!inset;
		};

		BoxShadow.prototype.toString = function () {
			var vals = [
				Math.round(this.hShadow) + 'px',
				Math.round(this.vShadow) + 'px',
				Math.round(this.blur) + 'px',
				Math.round(this.spread) + 'px',
				this.color
			];
			if (this.inset) {
				vals.push('inset');
			}
			return vals.join(' ');
		};

		return BoxShadow;
	})(),


	//
	// Usage:
	// var myColor = new jscolor(<targetElement> [, <options>])
	//

	jscolor : function (targetElement, options) {

		// General options
		//
		this.value = null; // initial HEX color. To change it later, use methods fromString(), fromHSV() and fromRGB()
		this.valueElement = targetElement; // element that will be used to display and input the color code
		this.styleElement = targetElement; // element that will preview the picked color using CSS backgroundColor
		this.required = true; // whether the associated text <input> can be left empty
		this.refine = true; // whether to refine the entered color code (e.g. uppercase it and remove whitespace)
		this.hash = false; // whether to prefix the HEX color code with # symbol
		this.uppercase = true; // whether to uppercase the color code
		this.onFineChange = null; // called instantly every time the color changes (value can be either a function or a string with javascript code)
		this.activeClass = 'jscolor-active'; // class to be set to the target element when a picker window is open on it
		this.minS = 0; // min allowed saturation (0 - 100)
		this.maxS = 100; // max allowed saturation (0 - 100)
		this.minV = 0; // min allowed value (brightness) (0 - 100)
		this.maxV = 100; // max allowed value (brightness) (0 - 100)

		// Accessing the picked color
		//
		this.hsv = [0, 0, 100]; // read-only  [0-360, 0-100, 0-100]
		this.rgb = [255, 255, 255]; // read-only  [0-255, 0-255, 0-255]

		// Color Picker options
		//
		this.width = 181; // width of color palette (in px)
		this.height = 101; // height of color palette (in px)
		this.showOnClick = true; // whether to display the color picker when user clicks on its target element
		this.mode = 'HSV'; // HSV | HVS | HS | HV - layout of the color picker controls
		this.position = 'bottom'; // left | right | top | bottom - position relative to the target element
		this.smartPosition = true; // automatically change picker position when there is not enough space for it
		this.sliderSize = 16; // px
		this.crossSize = 8; // px
		this.closable = false; // whether to display the Close button
		this.closeText = 'Close';
		this.buttonColor = '#000000'; // CSS color
		this.buttonHeight = 18; // px
		this.padding = 12; // px
		this.backgroundColor = '#FFFFFF'; // CSS color
		this.borderWidth = 1; // px
		this.borderColor = '#BBBBBB'; // CSS color
		this.borderRadius = 8; // px
		this.insetWidth = 1; // px
		this.insetColor = '#BBBBBB'; // CSS color
		this.shadow = true; // whether to display shadow
		this.shadowBlur = 15; // px
		this.shadowColor = 'rgba(0,0,0,0.2)'; // CSS color
		this.pointerColor = '#4C4C4C'; // px
		this.pointerBorderColor = '#FFFFFF'; // px
        this.pointerBorderWidth = 1; // px
        this.pointerThickness = 2; // px
		this.zIndex = 1000;
		this.container = null; // where to append the color picker (BODY element by default)


		for (var opt in options) {
			if (options.hasOwnProperty(opt)) {
				this[opt] = options[opt];
			}
		}


		this.hide = function () {
			if (isPickerOwner()) {
				detachPicker();
			}
		};


		this.show = function () {
			drawPicker();
		};


		this.redraw = function () {
			if (isPickerOwner()) {
				drawPicker();
			}
		};


		this.importColor = function () {
			if (!this.valueElement) {
				this.exportColor();
			} else {
				if (jsc.isElementType(this.valueElement, 'input')) {
					if (!this.refine) {
						if (!this.fromString(this.valueElement.value, jsc.leaveValue)) {
							if (this.styleElement) {
								this.styleElement.style.backgroundImage = this.styleElement._jscOrigStyle.backgroundImage;
								this.styleElement.style.backgroundColor = this.styleElement._jscOrigStyle.backgroundColor;
								this.styleElement.style.color = this.styleElement._jscOrigStyle.color;
							}
							this.exportColor(jsc.leaveValue | jsc.leaveStyle);
						}
					} else if (!this.required && /^\s*$/.test(this.valueElement.value)) {
						this.valueElement.value = '';
						if (this.styleElement) {
							this.styleElement.style.backgroundImage = this.styleElement._jscOrigStyle.backgroundImage;
							this.styleElement.style.backgroundColor = this.styleElement._jscOrigStyle.backgroundColor;
							this.styleElement.style.color = this.styleElement._jscOrigStyle.color;
						}
						this.exportColor(jsc.leaveValue | jsc.leaveStyle);

					} else if (this.fromString(this.valueElement.value)) {
						// managed to import color successfully from the value -> OK, don't do anything
					} else {
						this.exportColor();
					}
				} else {
					// not an input element -> doesn't have any value
					this.exportColor();
				}
			}
		};


		this.exportColor = function (flags) {
			if (!(flags & jsc.leaveValue) && this.valueElement) {
				var value = this.toString();
				if (this.uppercase) { value = value.toUpperCase(); }
				if (this.hash) { value = '#' + value; }

				if (jsc.isElementType(this.valueElement, 'input')) {
					this.valueElement.value = value;
				} else {
					this.valueElement.innerHTML = value;
				}
			}
			if (!(flags & jsc.leaveStyle)) {
				if (this.styleElement) {
					this.styleElement.style.backgroundImage = 'none';
					this.styleElement.style.backgroundColor = '#' + this.toString();
					this.styleElement.style.color = this.isLight() ? '#000' : '#FFF';
				}
			}
			if (!(flags & jsc.leavePad) && isPickerOwner()) {
				redrawPad();
			}
			if (!(flags & jsc.leaveSld) && isPickerOwner()) {
				redrawSld();
			}
		};


		// h: 0-360
		// s: 0-100
		// v: 0-100
		//
		this.fromHSV = function (h, s, v, flags) { // null = don't change
			if (h !== null) {
				if (isNaN(h)) { return false; }
				h = Math.max(0, Math.min(360, h));
			}
			if (s !== null) {
				if (isNaN(s)) { return false; }
				s = Math.max(0, Math.min(100, this.maxS, s), this.minS);
			}
			if (v !== null) {
				if (isNaN(v)) { return false; }
				v = Math.max(0, Math.min(100, this.maxV, v), this.minV);
			}

			this.rgb = HSV_RGB(
				h===null ? this.hsv[0] : (this.hsv[0]=h),
				s===null ? this.hsv[1] : (this.hsv[1]=s),
				v===null ? this.hsv[2] : (this.hsv[2]=v)
			);

			this.exportColor(flags);
		};


		// r: 0-255
		// g: 0-255
		// b: 0-255
		//
		this.fromRGB = function (r, g, b, flags) { // null = don't change
			if (r !== null) {
				if (isNaN(r)) { return false; }
				r = Math.max(0, Math.min(255, r));
			}
			if (g !== null) {
				if (isNaN(g)) { return false; }
				g = Math.max(0, Math.min(255, g));
			}
			if (b !== null) {
				if (isNaN(b)) { return false; }
				b = Math.max(0, Math.min(255, b));
			}

			var hsv = RGB_HSV(
				r===null ? this.rgb[0] : r,
				g===null ? this.rgb[1] : g,
				b===null ? this.rgb[2] : b
			);
			if (hsv[0] !== null) {
				this.hsv[0] = Math.max(0, Math.min(360, hsv[0]));
			}
			if (hsv[2] !== 0) {
				this.hsv[1] = hsv[1]===null ? null : Math.max(0, this.minS, Math.min(100, this.maxS, hsv[1]));
			}
			this.hsv[2] = hsv[2]===null ? null : Math.max(0, this.minV, Math.min(100, this.maxV, hsv[2]));

			// update RGB according to final HSV, as some values might be trimmed
			var rgb = HSV_RGB(this.hsv[0], this.hsv[1], this.hsv[2]);
			this.rgb[0] = rgb[0];
			this.rgb[1] = rgb[1];
			this.rgb[2] = rgb[2];

			this.exportColor(flags);
		};


		this.fromString = function (str, flags) {
			var m;
			if (m = str.match(/^\W*([0-9A-F]{3}([0-9A-F]{3})?)\W*$/i)) {
				// HEX notation
				//

				if (m[1].length === 6) {
					// 6-char notation
					this.fromRGB(
						parseInt(m[1].substr(0,2),16),
						parseInt(m[1].substr(2,2),16),
						parseInt(m[1].substr(4,2),16),
						flags
					);
				} else {
					// 3-char notation
					this.fromRGB(
						parseInt(m[1].charAt(0) + m[1].charAt(0),16),
						parseInt(m[1].charAt(1) + m[1].charAt(1),16),
						parseInt(m[1].charAt(2) + m[1].charAt(2),16),
						flags
					);
				}
				return true;

			} else if (m = str.match(/^\W*rgba?\(([^)]*)\)\W*$/i)) {
				var params = m[1].split(',');
				var re = /^\s*(\d*)(\.\d+)?\s*$/;
				var mR, mG, mB;
				if (
					params.length >= 3 &&
					(mR = params[0].match(re)) &&
					(mG = params[1].match(re)) &&
					(mB = params[2].match(re))
				) {
					var r = parseFloat((mR[1] || '0') + (mR[2] || ''));
					var g = parseFloat((mG[1] || '0') + (mG[2] || ''));
					var b = parseFloat((mB[1] || '0') + (mB[2] || ''));
					this.fromRGB(r, g, b, flags);
					return true;
				}
			}
			return false;
		};


		this.toString = function () {
			return (
				(0x100 | Math.round(this.rgb[0])).toString(16).substr(1) +
				(0x100 | Math.round(this.rgb[1])).toString(16).substr(1) +
				(0x100 | Math.round(this.rgb[2])).toString(16).substr(1)
			);
		};


		this.toHEXString = function () {
			return '#' + this.toString().toUpperCase();
		};


		this.toRGBString = function () {
			return ('rgb(' +
				Math.round(this.rgb[0]) + ',' +
				Math.round(this.rgb[1]) + ',' +
				Math.round(this.rgb[2]) + ')'
			);
		};


		this.isLight = function () {
			return (
				0.213 * this.rgb[0] +
				0.715 * this.rgb[1] +
				0.072 * this.rgb[2] >
				255 / 2
			);
		};


		this._processParentElementsInDOM = function () {
			if (this._linkedElementsProcessed) { return; }
			this._linkedElementsProcessed = true;

			var elm = this.targetElement;
			do {
				// If the target element or one of its parent nodes has fixed position,
				// then use fixed positioning instead
				//
				// Note: In Firefox, getComputedStyle returns null in a hidden iframe,
				// that's why we need to check if the returned style object is non-empty
				var currStyle = jsc.getStyle(elm);
				if (currStyle && currStyle.position.toLowerCase() === 'fixed') {
					this.fixed = true;
				}

				if (elm !== this.targetElement) {
					// Ensure to attach onParentScroll only once to each parent element
					// (multiple targetElements can share the same parent nodes)
					//
					// Note: It's not just offsetParents that can be scrollable,
					// that's why we loop through all parent nodes
					if (!elm._jscEventsAttached) {
						jsc.attachEvent(elm, 'scroll', jsc.onParentScroll);
						elm._jscEventsAttached = true;
					}
				}
			} while ((elm = elm.parentNode) && !jsc.isElementType(elm, 'body'));
		};


		// r: 0-255
		// g: 0-255
		// b: 0-255
		//
		// returns: [ 0-360, 0-100, 0-100 ]
		//
		function RGB_HSV (r, g, b) {
			r /= 255;
			g /= 255;
			b /= 255;
			var n = Math.min(Math.min(r,g),b);
			var v = Math.max(Math.max(r,g),b);
			var m = v - n;
			if (m === 0) { return [ null, 0, 100 * v ]; }
			var h = r===n ? 3+(b-g)/m : (g===n ? 5+(r-b)/m : 1+(g-r)/m);
			return [
				60 * (h===6?0:h),
				100 * (m/v),
				100 * v
			];
		}


		// h: 0-360
		// s: 0-100
		// v: 0-100
		//
		// returns: [ 0-255, 0-255, 0-255 ]
		//
		function HSV_RGB (h, s, v) {
			var u = 255 * (v / 100);

			if (h === null) {
				return [ u, u, u ];
			}

			h /= 60;
			s /= 100;

			var i = Math.floor(h);
			var f = i%2 ? h-i : 1-(h-i);
			var m = u * (1 - s);
			var n = u * (1 - s * f);
			switch (i) {
				case 6:
				case 0: return [u,n,m];
				case 1: return [n,u,m];
				case 2: return [m,u,n];
				case 3: return [m,n,u];
				case 4: return [n,m,u];
				case 5: return [u,m,n];
			}
		}


		function detachPicker () {
			jsc.unsetClass(THIS.targetElement, THIS.activeClass);
			jsc.picker.wrap.parentNode.removeChild(jsc.picker.wrap);
			delete jsc.picker.owner;
		}


		function drawPicker () {

			// At this point, when drawing the picker, we know what the parent elements are
			// and we can do all related DOM operations, such as registering events on them
			// or checking their positioning
			THIS._processParentElementsInDOM();

			if (!jsc.picker) {
				jsc.picker = {
					owner: null,
					wrap : document.createElement('div'),
					box : document.createElement('div'),
					boxS : document.createElement('div'), // shadow area
					boxB : document.createElement('div'), // border
					pad : document.createElement('div'),
					padB : document.createElement('div'), // border
					padM : document.createElement('div'), // mouse/touch area
					padPal : jsc.createPalette(),
					cross : document.createElement('div'),
					crossBY : document.createElement('div'), // border Y
					crossBX : document.createElement('div'), // border X
					crossLY : document.createElement('div'), // line Y
					crossLX : document.createElement('div'), // line X
					sld : document.createElement('div'),
					sldB : document.createElement('div'), // border
					sldM : document.createElement('div'), // mouse/touch area
					sldGrad : jsc.createSliderGradient(),
					sldPtrS : document.createElement('div'), // slider pointer spacer
					sldPtrIB : document.createElement('div'), // slider pointer inner border
					sldPtrMB : document.createElement('div'), // slider pointer middle border
					sldPtrOB : document.createElement('div'), // slider pointer outer border
					btn : document.createElement('div'),
					btnT : document.createElement('span') // text
				};

				jsc.picker.pad.appendChild(jsc.picker.padPal.elm);
				jsc.picker.padB.appendChild(jsc.picker.pad);
				jsc.picker.cross.appendChild(jsc.picker.crossBY);
				jsc.picker.cross.appendChild(jsc.picker.crossBX);
				jsc.picker.cross.appendChild(jsc.picker.crossLY);
				jsc.picker.cross.appendChild(jsc.picker.crossLX);
				jsc.picker.padB.appendChild(jsc.picker.cross);
				jsc.picker.box.appendChild(jsc.picker.padB);
				jsc.picker.box.appendChild(jsc.picker.padM);

				jsc.picker.sld.appendChild(jsc.picker.sldGrad.elm);
				jsc.picker.sldB.appendChild(jsc.picker.sld);
				jsc.picker.sldB.appendChild(jsc.picker.sldPtrOB);
				jsc.picker.sldPtrOB.appendChild(jsc.picker.sldPtrMB);
				jsc.picker.sldPtrMB.appendChild(jsc.picker.sldPtrIB);
				jsc.picker.sldPtrIB.appendChild(jsc.picker.sldPtrS);
				jsc.picker.box.appendChild(jsc.picker.sldB);
				jsc.picker.box.appendChild(jsc.picker.sldM);

				jsc.picker.btn.appendChild(jsc.picker.btnT);
				jsc.picker.box.appendChild(jsc.picker.btn);

				jsc.picker.boxB.appendChild(jsc.picker.box);
				jsc.picker.wrap.appendChild(jsc.picker.boxS);
				jsc.picker.wrap.appendChild(jsc.picker.boxB);
			}

			var p = jsc.picker;

			var displaySlider = !!jsc.getSliderComponent(THIS);
			var dims = jsc.getPickerDims(THIS);
			var crossOuterSize = (2 * THIS.pointerBorderWidth + THIS.pointerThickness + 2 * THIS.crossSize);
			var padToSliderPadding = jsc.getPadToSliderPadding(THIS);
			var borderRadius = Math.min(
				THIS.borderRadius,
				Math.round(THIS.padding * Math.PI)); // px
			var padCursor = 'crosshair';

			// wrap
			p.wrap.style.clear = 'both';
			p.wrap.style.width = (dims[0] + 2 * THIS.borderWidth) + 'px';
			p.wrap.style.height = (dims[1] + 2 * THIS.borderWidth) + 'px';
			p.wrap.style.zIndex = THIS.zIndex;

			// picker
			p.box.style.width = dims[0] + 'px';
			p.box.style.height = dims[1] + 'px';

			p.boxS.style.position = 'absolute';
			p.boxS.style.left = '0';
			p.boxS.style.top = '0';
			p.boxS.style.width = '100%';
			p.boxS.style.height = '100%';
			jsc.setBorderRadius(p.boxS, borderRadius + 'px');

			// picker border
			p.boxB.style.position = 'relative';
			p.boxB.style.border = THIS.borderWidth + 'px solid';
			p.boxB.style.borderColor = THIS.borderColor;
			p.boxB.style.background = THIS.backgroundColor;
			jsc.setBorderRadius(p.boxB, borderRadius + 'px');

			// IE hack:
			// If the element is transparent, IE will trigger the event on the elements under it,
			// e.g. on Canvas or on elements with border
			p.padM.style.background =
			p.sldM.style.background =
				'#FFF';
			jsc.setStyle(p.padM, 'opacity', '0');
			jsc.setStyle(p.sldM, 'opacity', '0');

			// pad
			p.pad.style.position = 'relative';
			p.pad.style.width = THIS.width + 'px';
			p.pad.style.height = THIS.height + 'px';

			// pad palettes (HSV and HVS)
			p.padPal.draw(THIS.width, THIS.height, jsc.getPadYComponent(THIS));

			// pad border
			p.padB.style.position = 'absolute';
			p.padB.style.left = THIS.padding + 'px';
			p.padB.style.top = THIS.padding + 'px';
			p.padB.style.border = THIS.insetWidth + 'px solid';
			p.padB.style.borderColor = THIS.insetColor;

			// pad mouse area
			p.padM._jscInstance = THIS;
			p.padM._jscControlName = 'pad';
			p.padM.style.position = 'absolute';
			p.padM.style.left = '0';
			p.padM.style.top = '0';
			p.padM.style.width = (THIS.padding + 2 * THIS.insetWidth + THIS.width + padToSliderPadding / 2) + 'px';
			p.padM.style.height = dims[1] + 'px';
			p.padM.style.cursor = padCursor;

			// pad cross
			p.cross.style.position = 'absolute';
			p.cross.style.left =
			p.cross.style.top =
				'0';
			p.cross.style.width =
			p.cross.style.height =
				crossOuterSize + 'px';

			// pad cross border Y and X
			p.crossBY.style.position =
			p.crossBX.style.position =
				'absolute';
			p.crossBY.style.background =
			p.crossBX.style.background =
				THIS.pointerBorderColor;
			p.crossBY.style.width =
			p.crossBX.style.height =
				(2 * THIS.pointerBorderWidth + THIS.pointerThickness) + 'px';
			p.crossBY.style.height =
			p.crossBX.style.width =
				crossOuterSize + 'px';
			p.crossBY.style.left =
			p.crossBX.style.top =
				(Math.floor(crossOuterSize / 2) - Math.floor(THIS.pointerThickness / 2) - THIS.pointerBorderWidth) + 'px';
			p.crossBY.style.top =
			p.crossBX.style.left =
				'0';

			// pad cross line Y and X
			p.crossLY.style.position =
			p.crossLX.style.position =
				'absolute';
			p.crossLY.style.background =
			p.crossLX.style.background =
				THIS.pointerColor;
			p.crossLY.style.height =
			p.crossLX.style.width =
				(crossOuterSize - 2 * THIS.pointerBorderWidth) + 'px';
			p.crossLY.style.width =
			p.crossLX.style.height =
				THIS.pointerThickness + 'px';
			p.crossLY.style.left =
			p.crossLX.style.top =
				(Math.floor(crossOuterSize / 2) - Math.floor(THIS.pointerThickness / 2)) + 'px';
			p.crossLY.style.top =
			p.crossLX.style.left =
				THIS.pointerBorderWidth + 'px';

			// slider
			p.sld.style.overflow = 'hidden';
			p.sld.style.width = THIS.sliderSize + 'px';
			p.sld.style.height = THIS.height + 'px';

			// slider gradient
			p.sldGrad.draw(THIS.sliderSize, THIS.height, '#000', '#000');

			// slider border
			p.sldB.style.display = displaySlider ? 'block' : 'none';
			p.sldB.style.position = 'absolute';
			p.sldB.style.right = THIS.padding + 'px';
			p.sldB.style.top = THIS.padding + 'px';
			p.sldB.style.border = THIS.insetWidth + 'px solid';
			p.sldB.style.borderColor = THIS.insetColor;

			// slider mouse area
			p.sldM._jscInstance = THIS;
			p.sldM._jscControlName = 'sld';
			p.sldM.style.display = displaySlider ? 'block' : 'none';
			p.sldM.style.position = 'absolute';
			p.sldM.style.right = '0';
			p.sldM.style.top = '0';
			p.sldM.style.width = (THIS.sliderSize + padToSliderPadding / 2 + THIS.padding + 2 * THIS.insetWidth) + 'px';
			p.sldM.style.height = dims[1] + 'px';
			p.sldM.style.cursor = 'default';

			// slider pointer inner and outer border
			p.sldPtrIB.style.border =
			p.sldPtrOB.style.border =
				THIS.pointerBorderWidth + 'px solid ' + THIS.pointerBorderColor;

			// slider pointer outer border
			p.sldPtrOB.style.position = 'absolute';
			p.sldPtrOB.style.left = -(2 * THIS.pointerBorderWidth + THIS.pointerThickness) + 'px';
			p.sldPtrOB.style.top = '0';

			// slider pointer middle border
			p.sldPtrMB.style.border = THIS.pointerThickness + 'px solid ' + THIS.pointerColor;

			// slider pointer spacer
			p.sldPtrS.style.width = THIS.sliderSize + 'px';
			p.sldPtrS.style.height = sliderPtrSpace + 'px';

			// the Close button
			function setBtnBorder () {
				var insetColors = THIS.insetColor.split(/\s+/);
				var outsetColor = insetColors.length < 2 ? insetColors[0] : insetColors[1] + ' ' + insetColors[0] + ' ' + insetColors[0] + ' ' + insetColors[1];
				p.btn.style.borderColor = outsetColor;
			}
			p.btn.style.display = THIS.closable ? 'block' : 'none';
			p.btn.style.position = 'absolute';
			p.btn.style.left = THIS.padding + 'px';
			p.btn.style.bottom = THIS.padding + 'px';
			p.btn.style.padding = '0 15px';
			p.btn.style.height = THIS.buttonHeight + 'px';
			p.btn.style.border = THIS.insetWidth + 'px solid';
			setBtnBorder();
			p.btn.style.color = THIS.buttonColor;
			p.btn.style.font = '12px sans-serif';
			p.btn.style.textAlign = 'center';
			try {
				p.btn.style.cursor = 'pointer';
			} catch(eOldIE) {
				p.btn.style.cursor = 'hand';
			}
			p.btn.onmousedown = function () {
				THIS.hide();
			};
			p.btnT.style.lineHeight = THIS.buttonHeight + 'px';
			p.btnT.innerHTML = '';
			p.btnT.appendChild(document.createTextNode(THIS.closeText));

			// place pointers
			redrawPad();
			redrawSld();

			// If we are changing the owner without first closing the picker,
			// make sure to first deal with the old owner
			if (jsc.picker.owner && jsc.picker.owner !== THIS) {
				jsc.unsetClass(jsc.picker.owner.targetElement, THIS.activeClass);
			}

			// Set the new picker owner
			jsc.picker.owner = THIS;

			// The redrawPosition() method needs picker.owner to be set, that's why we call it here,
			// after setting the owner
			if (jsc.isElementType(container, 'body')) {
				jsc.redrawPosition();
			} else {
				jsc._drawPosition(THIS, 0, 0, 'relative', false);
			}

			if (p.wrap.parentNode != container) {
				container.appendChild(p.wrap);
			}

			jsc.setClass(THIS.targetElement, THIS.activeClass);
		}


		function redrawPad () {
			// redraw the pad pointer
			switch (jsc.getPadYComponent(THIS)) {
			case 's': var yComponent = 1; break;
			case 'v': var yComponent = 2; break;
			}
			var x = Math.round((THIS.hsv[0] / 360) * (THIS.width - 1));
			var y = Math.round((1 - THIS.hsv[yComponent] / 100) * (THIS.height - 1));
			var crossOuterSize = (2 * THIS.pointerBorderWidth + THIS.pointerThickness + 2 * THIS.crossSize);
			var ofs = -Math.floor(crossOuterSize / 2);
			jsc.picker.cross.style.left = (x + ofs) + 'px';
			jsc.picker.cross.style.top = (y + ofs) + 'px';

			// redraw the slider
			switch (jsc.getSliderComponent(THIS)) {
			case 's':
				var rgb1 = HSV_RGB(THIS.hsv[0], 100, THIS.hsv[2]);
				var rgb2 = HSV_RGB(THIS.hsv[0], 0, THIS.hsv[2]);
				var color1 = 'rgb(' +
					Math.round(rgb1[0]) + ',' +
					Math.round(rgb1[1]) + ',' +
					Math.round(rgb1[2]) + ')';
				var color2 = 'rgb(' +
					Math.round(rgb2[0]) + ',' +
					Math.round(rgb2[1]) + ',' +
					Math.round(rgb2[2]) + ')';
				jsc.picker.sldGrad.draw(THIS.sliderSize, THIS.height, color1, color2);
				break;
			case 'v':
				var rgb = HSV_RGB(THIS.hsv[0], THIS.hsv[1], 100);
				var color1 = 'rgb(' +
					Math.round(rgb[0]) + ',' +
					Math.round(rgb[1]) + ',' +
					Math.round(rgb[2]) + ')';
				var color2 = '#000';
				jsc.picker.sldGrad.draw(THIS.sliderSize, THIS.height, color1, color2);
				break;
			}
		}


		function redrawSld () {
			var sldComponent = jsc.getSliderComponent(THIS);
			if (sldComponent) {
				// redraw the slider pointer
				switch (sldComponent) {
				case 's': var yComponent = 1; break;
				case 'v': var yComponent = 2; break;
				}
				var y = Math.round((1 - THIS.hsv[yComponent] / 100) * (THIS.height - 1));
				jsc.picker.sldPtrOB.style.top = (y - (2 * THIS.pointerBorderWidth + THIS.pointerThickness) - Math.floor(sliderPtrSpace / 2)) + 'px';
			}
		}


		function isPickerOwner () {
			return jsc.picker && jsc.picker.owner === THIS;
		}


		function blurValue () {
			THIS.importColor();
		}


		// Find the target element
		if (typeof targetElement === 'string') {
			var id = targetElement;
			var elm = document.getElementById(id);
			if (elm) {
				this.targetElement = elm;
			} else {
				jsc.warn('Could not find target element with ID \'' + id + '\'');
			}
		} else if (targetElement) {
			this.targetElement = targetElement;
		} else {
			jsc.warn('Invalid target element: \'' + targetElement + '\'');
		}

		if (this.targetElement._jscLinkedInstance) {
			jsc.warn('Cannot link jscolor twice to the same element. Skipping.');
			return;
		}
		this.targetElement._jscLinkedInstance = this;

		// Find the value element
		this.valueElement = jsc.fetchElement(this.valueElement);
		// Find the style element
		this.styleElement = jsc.fetchElement(this.styleElement);

		var THIS = this;
		var container =
			this.container ?
			jsc.fetchElement(this.container) :
			document.getElementsByTagName('body')[0];
		var sliderPtrSpace = 3; // px

		// For BUTTON elements it's important to stop them from sending the form when clicked
		// (e.g. in Safari)
		if (jsc.isElementType(this.targetElement, 'button')) {
			if (this.targetElement.onclick) {
				var origCallback = this.targetElement.onclick;
				this.targetElement.onclick = function (evt) {
					origCallback.call(this, evt);
					return false;
				};
			} else {
				this.targetElement.onclick = function () { return false; };
			}
		}

		/*
		var elm = this.targetElement;
		do {
			// If the target element or one of its offsetParents has fixed position,
			// then use fixed positioning instead
			//
			// Note: In Firefox, getComputedStyle returns null in a hidden iframe,
			// that's why we need to check if the returned style object is non-empty
			var currStyle = jsc.getStyle(elm);
			if (currStyle && currStyle.position.toLowerCase() === 'fixed') {
				this.fixed = true;
			}

			if (elm !== this.targetElement) {
				// attach onParentScroll so that we can recompute the picker position
				// when one of the offsetParents is scrolled
				if (!elm._jscEventsAttached) {
					jsc.attachEvent(elm, 'scroll', jsc.onParentScroll);
					elm._jscEventsAttached = true;
				}
			}
		} while ((elm = elm.offsetParent) && !jsc.isElementType(elm, 'body'));
		*/

		// valueElement
		if (this.valueElement) {
			if (jsc.isElementType(this.valueElement, 'input')) {
				var updateField = function () {
					THIS.fromString(THIS.valueElement.value, jsc.leaveValue);
					jsc.dispatchFineChange(THIS);
				};
				jsc.attachEvent(this.valueElement, 'keyup', updateField);
				jsc.attachEvent(this.valueElement, 'input', updateField);
				jsc.attachEvent(this.valueElement, 'blur', blurValue);
				this.valueElement.setAttribute('autocomplete', 'off');
			}
		}

		// styleElement
		if (this.styleElement) {
			this.styleElement._jscOrigStyle = {
				backgroundImage : this.styleElement.style.backgroundImage,
				backgroundColor : this.styleElement.style.backgroundColor,
				color : this.styleElement.style.color
			};
		}

		if (this.value) {
			// Try to set the color from the .value option and if unsuccessful,
			// export the current color
			this.fromString(this.value) || this.exportColor();
		} else {
			this.importColor();
		}
	}

};


//================================
// Public properties and methods
//================================


// By default, search for all elements with class="jscolor" and install a color picker on them.
//
// You can change what class name will be looked for by setting the property jscolor.lookupClass
// anywhere in your HTML document. To completely disable the automatic lookup, set it to null.
//
jsc.jscolor.lookupClass = 'jscolor';


jsc.jscolor.installByClassName = function(className) {
	var inputElms = document.getElementsByTagName('input');
	var buttonElms = document.getElementsByTagName('button');

	jsc.tryInstallOnElements(inputElms, className);
	jsc.tryInstallOnElements(buttonElms, className);
};


jsc.register();


return jsc;


});

define('colorStop',['jscolor'], function(jsc) {

	var jscolor = jsc.jscolor;

	function ColorStop(gradient, position, color, size) {

		this.gradient = gradient;
		this.position = position;
		this.color = color;
		
		this.size = size;

		this.width = this.gradient.domElement.clientHeight/(10-this.size);
		this.height = this.gradient.domElement.clientHeight + this.gradient.domElement.clientHeight*0.5;

		this.addDomElement();

	}

	ColorStop.prototype.addDomElement = function() {

		var _this = this;

		var x = this.gradient.domElement.clientWidth * this.position;
		if (x < 0) x = 0;
		if (x > this.gradient.domElement.clientWidth-this.width) x = this.gradient.domElement.clientWidth - this.width;

		this.square = document.createElement('div');
		this.square.style.position = 'absolute';
		this.square.style.left = x + 'px'; 
		this.square.style.bottom = -1 - this.gradient.domElement.clientHeight*0.25 + 'px';
		this.square.style.width = this.width + 'px';
		this.square.style.height = this.height + 'px';
		this.square.style.borderRadius = 20 + 'px';
		this.square.style.background = this.colorToString();
		this.square.style.border = '1px solid #111';
		this.square.style.cursor = 'pointer';

		this.cp = document.createElement('input');
		this.cp.className = 'jscolor';
		this.cp.value = this.colorToString()
		this.cp.style.width = 0;
		this.cp.style.height = 0;
		this.cp.style.margin = 0;
		this.cp.style.padding = 0;
		this.cp.style.border = 'None';

		this.square.ondblclick = function(evt) {
		 	this.children[0].jscolor.show();
		 	this.children[0].jscolor.onFineChange = function() {
		 		_this.color = [Math.round(this.rgb[0]), Math.round(this.rgb[1]), Math.round(this.rgb[2]), 1];
		 		_this.square.style.background = _this.colorToString();
		 		_this.gradient.calculateGradient();
		 	};
		};
		this.square.onmouseover = function(evt) {
			_this.hover = true;
			_this.gradient.hover = true;
		};
		this.square.onmousedown = function(evt) {
			_this.drag = true;
		};
		this.gradient.domElement.addEventListener('mousemove', function(evt) {
			if (_this.drag) {
				var x = evt.clientX - _this.gradient.domElement.offsetLeft - _this.width/2
				if (x < 0) x = 0;
				if (x > _this.gradient.domElement.clientWidth-_this.width) x = _this.gradient.domElement.clientWidth - _this.width;
				_this.square.style.left = x +'px';
				_this.position = x/_this.gradient.domElement.clientWidth;
				_this.gradient.calculateGradient();
			}
		});
		window.addEventListener('mouseup', function(evt) {
			_this.drag = false;
		});
		this.square.onmouseout = function(evt) {
			_this.hover = false;
			_this.gradient.hover = false;
		};

		this.square.append(this.cp);
		// this.square.append(this.triangle);
		this.gradient.domElement.append(this.square);

		jsc.register()
	};
	ColorStop.prototype.colorToString = function() {
		return 'rgba('+this.color[0]+', '+this.color[1]+', '+this.color[2]+', '+this.color[3]+')';
	};

	return ColorStop;

});
define('Gradient',['colorStop'], function(ColorStop) {

	function Gradient(domElement, size) {

		var _this = this

		this.domElement = domElement;

		this.colorStops = [];

		this.colorStopSize = size;

		this.createInitialColorStops();
		this.calculateGradient();

		this.domElement.onclick = function(evt) {
			if (!_this.hover) {
				var x = (evt.clientX - this.offsetLeft) / this.clientWidth;
				_this.addColorStop(x, _this.getColor(x))
			}
		}
		this.domElement.oncontextmenu = function(evt) {
			if (_this.hover) {
				var cs;
				for (var i = 0; i < _this.colorStops.length; i++) {
					cs = _this.colorStops[i];
					if (cs.hover) {
						break
					}
				}
				if (_this.colorStops.length > 1) {
					_this.removeColorStop(evt.toElement, cs)
					_this.hover = false;
				}
			}
			return false;
		}

	}

	Gradient.prototype.createInitialColorStops = function() {
		
		this.addColorStop(0, [255, 0, 0, 1]);
		this.addColorStop(1, [128, 0, 0, 1]);

	};
	Gradient.prototype.addColorStop = function(position, color) {
		var newCS = new ColorStop(this, position, color, this.colorStopSize);

		this.colorStops.push(newCS);

	};
	Gradient.prototype.removeColorStop = function(div, cs) {
		this.domElement.removeChild(div);

		var i = this.colorStops.indexOf(cs);
		this.colorStops.splice(i, 1);

		this.calculateGradient()
	};
	Gradient.prototype.calculateGradient = function() {
		
		this.colorStops.sort(function(a,b){
			return a.position - b.position;
		});
		
		var str = '';
		var j;
		for (j = 0; j < this.colorStops.length; j++) {
			var c = this.colorStops[j];
			str += ', ' + c.colorToString() + ' ' + Math.round(c.position*10000)/100 + '%';
		}
		if (j > 1) {
			this.domElement.style.background = 'linear-gradient(to right' + str + ')';
		} else {
			str = this.colorStops[0].colorToString();
			this.domElement.style.background = str;
		}

	};
	Gradient.prototype.getColor = function(position) {
		if (this.colorStops.length > 1) {
			for (var i = 1; i < this.colorStops.length; i++) {
				var k = this.colorStops[i];
				if (position <= k.position && position >= this.colorStops[i-1].position) {
					var percent = position * (1/k.position);
					return this.getColorFormula(k.color, this.colorStops[i-1].color, percent);
				}
			}
			if (position < this.colorStops[0].position) {
				return this.colorStops[0].color;
			}
			if (position > this.colorStops[this.colorStops.length-1].position) {
				return this.colorStops[this.colorStops.length-1].color;
			}
		} else {
			return this.colorStops[0].color;
		}
	};
	Gradient.prototype.getColorFormula = function(color1, color2, weight) {
		
		var p = weight;
	    var w = p * 2 - 1;
	    var w1 = (w/1+1) / 2;
	    var w2 = 1 - w1;
	    var color = [
	    		Math.round(color1[0] * w1 + color2[0] * w2),
	      		Math.round(color1[1] * w1 + color2[1] * w2),
	       		Math.round(color1[2] * w1 + color2[2] * w2),
	       		1
	       	];

	    return color;

	};

	return Gradient;

}) ;
define('main',['Gradient'], function(Gradient) {

	return Gradient;

});
return require('main')}))

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvbmZpZy13cmFwLXN0YXJ0LWRlZmF1bHQuanMiLCIuLi8uLi8uLi8uLi9ib3dlcl9jb21wb25lbnRzL2FsbW9uZC9hbG1vbmQuanMiLCJqc2NvbG9yLmpzIiwiY29sb3JTdG9wLmpzIiwiR3JhZGllbnQuanMiLCJtYWluLmpzIiwiLi4vLi4vY29uZmlnLXdyYXAtZW5kLWRlZmF1bHQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQSxBQ0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxBQ3JiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsQUNqekRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEFDN0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxBQ3ZIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsQUNMQTtBQUNBIiwiZmlsZSI6ImdyYWRpZW50LmpzIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKHJvb3QsZmFjdG9yeSl7aWYodHlwZW9mIGRlZmluZT09PSdmdW5jdGlvbicmJmRlZmluZS5hbWQpe2RlZmluZShbXSxmYWN0b3J5KX1lbHNle3Jvb3QuR3JhZGllbnQ9ZmFjdG9yeSgpfX0odGhpcyxmdW5jdGlvbigpe1xuIiwiLyoqXG4gKiBAbGljZW5zZSBhbG1vbmQgMC4zLjMgQ29weXJpZ2h0IGpRdWVyeSBGb3VuZGF0aW9uIGFuZCBvdGhlciBjb250cmlidXRvcnMuXG4gKiBSZWxlYXNlZCB1bmRlciBNSVQgbGljZW5zZSwgaHR0cDovL2dpdGh1Yi5jb20vcmVxdWlyZWpzL2FsbW9uZC9MSUNFTlNFXG4gKi9cbi8vR29pbmcgc2xvcHB5IHRvIGF2b2lkICd1c2Ugc3RyaWN0JyBzdHJpbmcgY29zdCwgYnV0IHN0cmljdCBwcmFjdGljZXMgc2hvdWxkXG4vL2JlIGZvbGxvd2VkLlxuLypnbG9iYWwgc2V0VGltZW91dDogZmFsc2UgKi9cblxudmFyIHJlcXVpcmVqcywgcmVxdWlyZSwgZGVmaW5lO1xuKGZ1bmN0aW9uICh1bmRlZikge1xuICAgIHZhciBtYWluLCByZXEsIG1ha2VNYXAsIGhhbmRsZXJzLFxuICAgICAgICBkZWZpbmVkID0ge30sXG4gICAgICAgIHdhaXRpbmcgPSB7fSxcbiAgICAgICAgY29uZmlnID0ge30sXG4gICAgICAgIGRlZmluaW5nID0ge30sXG4gICAgICAgIGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHksXG4gICAgICAgIGFwcyA9IFtdLnNsaWNlLFxuICAgICAgICBqc1N1ZmZpeFJlZ0V4cCA9IC9cXC5qcyQvO1xuXG4gICAgZnVuY3Rpb24gaGFzUHJvcChvYmosIHByb3ApIHtcbiAgICAgICAgcmV0dXJuIGhhc093bi5jYWxsKG9iaiwgcHJvcCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2l2ZW4gYSByZWxhdGl2ZSBtb2R1bGUgbmFtZSwgbGlrZSAuL3NvbWV0aGluZywgbm9ybWFsaXplIGl0IHRvXG4gICAgICogYSByZWFsIG5hbWUgdGhhdCBjYW4gYmUgbWFwcGVkIHRvIGEgcGF0aC5cbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSB0aGUgcmVsYXRpdmUgbmFtZVxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBiYXNlTmFtZSBhIHJlYWwgbmFtZSB0aGF0IHRoZSBuYW1lIGFyZyBpcyByZWxhdGl2ZVxuICAgICAqIHRvLlxuICAgICAqIEByZXR1cm5zIHtTdHJpbmd9IG5vcm1hbGl6ZWQgbmFtZVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZShuYW1lLCBiYXNlTmFtZSkge1xuICAgICAgICB2YXIgbmFtZVBhcnRzLCBuYW1lU2VnbWVudCwgbWFwVmFsdWUsIGZvdW5kTWFwLCBsYXN0SW5kZXgsXG4gICAgICAgICAgICBmb3VuZEksIGZvdW5kU3Rhck1hcCwgc3RhckksIGksIGosIHBhcnQsIG5vcm1hbGl6ZWRCYXNlUGFydHMsXG4gICAgICAgICAgICBiYXNlUGFydHMgPSBiYXNlTmFtZSAmJiBiYXNlTmFtZS5zcGxpdChcIi9cIiksXG4gICAgICAgICAgICBtYXAgPSBjb25maWcubWFwLFxuICAgICAgICAgICAgc3Rhck1hcCA9IChtYXAgJiYgbWFwWycqJ10pIHx8IHt9O1xuXG4gICAgICAgIC8vQWRqdXN0IGFueSByZWxhdGl2ZSBwYXRocy5cbiAgICAgICAgaWYgKG5hbWUpIHtcbiAgICAgICAgICAgIG5hbWUgPSBuYW1lLnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBsYXN0SW5kZXggPSBuYW1lLmxlbmd0aCAtIDE7XG5cbiAgICAgICAgICAgIC8vIElmIHdhbnRpbmcgbm9kZSBJRCBjb21wYXRpYmlsaXR5LCBzdHJpcCAuanMgZnJvbSBlbmRcbiAgICAgICAgICAgIC8vIG9mIElEcy4gSGF2ZSB0byBkbyB0aGlzIGhlcmUsIGFuZCBub3QgaW4gbmFtZVRvVXJsXG4gICAgICAgICAgICAvLyBiZWNhdXNlIG5vZGUgYWxsb3dzIGVpdGhlciAuanMgb3Igbm9uIC5qcyB0byBtYXBcbiAgICAgICAgICAgIC8vIHRvIHNhbWUgZmlsZS5cbiAgICAgICAgICAgIGlmIChjb25maWcubm9kZUlkQ29tcGF0ICYmIGpzU3VmZml4UmVnRXhwLnRlc3QobmFtZVtsYXN0SW5kZXhdKSkge1xuICAgICAgICAgICAgICAgIG5hbWVbbGFzdEluZGV4XSA9IG5hbWVbbGFzdEluZGV4XS5yZXBsYWNlKGpzU3VmZml4UmVnRXhwLCAnJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFN0YXJ0cyB3aXRoIGEgJy4nIHNvIG5lZWQgdGhlIGJhc2VOYW1lXG4gICAgICAgICAgICBpZiAobmFtZVswXS5jaGFyQXQoMCkgPT09ICcuJyAmJiBiYXNlUGFydHMpIHtcbiAgICAgICAgICAgICAgICAvL0NvbnZlcnQgYmFzZU5hbWUgdG8gYXJyYXksIGFuZCBsb3Agb2ZmIHRoZSBsYXN0IHBhcnQsXG4gICAgICAgICAgICAgICAgLy9zbyB0aGF0IC4gbWF0Y2hlcyB0aGF0ICdkaXJlY3RvcnknIGFuZCBub3QgbmFtZSBvZiB0aGUgYmFzZU5hbWUnc1xuICAgICAgICAgICAgICAgIC8vbW9kdWxlLiBGb3IgaW5zdGFuY2UsIGJhc2VOYW1lIG9mICdvbmUvdHdvL3RocmVlJywgbWFwcyB0b1xuICAgICAgICAgICAgICAgIC8vJ29uZS90d28vdGhyZWUuanMnLCBidXQgd2Ugd2FudCB0aGUgZGlyZWN0b3J5LCAnb25lL3R3bycgZm9yXG4gICAgICAgICAgICAgICAgLy90aGlzIG5vcm1hbGl6YXRpb24uXG4gICAgICAgICAgICAgICAgbm9ybWFsaXplZEJhc2VQYXJ0cyA9IGJhc2VQYXJ0cy5zbGljZSgwLCBiYXNlUGFydHMubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgbmFtZSA9IG5vcm1hbGl6ZWRCYXNlUGFydHMuY29uY2F0KG5hbWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvL3N0YXJ0IHRyaW1Eb3RzXG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgbmFtZS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHBhcnQgPSBuYW1lW2ldO1xuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09PSAnLicpIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZS5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIGkgLT0gMTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBhcnQgPT09ICcuLicpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgYXQgdGhlIHN0YXJ0LCBvciBwcmV2aW91cyB2YWx1ZSBpcyBzdGlsbCAuLixcbiAgICAgICAgICAgICAgICAgICAgLy8ga2VlcCB0aGVtIHNvIHRoYXQgd2hlbiBjb252ZXJ0ZWQgdG8gYSBwYXRoIGl0IG1heVxuICAgICAgICAgICAgICAgICAgICAvLyBzdGlsbCB3b3JrIHdoZW4gY29udmVydGVkIHRvIGEgcGF0aCwgZXZlbiB0aG91Z2hcbiAgICAgICAgICAgICAgICAgICAgLy8gYXMgYW4gSUQgaXQgaXMgbGVzcyB0aGFuIGlkZWFsLiBJbiBsYXJnZXIgcG9pbnRcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVsZWFzZXMsIG1heSBiZSBiZXR0ZXIgdG8ganVzdCBraWNrIG91dCBhbiBlcnJvci5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGkgPT09IDAgfHwgKGkgPT09IDEgJiYgbmFtZVsyXSA9PT0gJy4uJykgfHwgbmFtZVtpIC0gMV0gPT09ICcuLicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGkgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lLnNwbGljZShpIC0gMSwgMik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpIC09IDI7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL2VuZCB0cmltRG90c1xuXG4gICAgICAgICAgICBuYW1lID0gbmFtZS5qb2luKCcvJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvL0FwcGx5IG1hcCBjb25maWcgaWYgYXZhaWxhYmxlLlxuICAgICAgICBpZiAoKGJhc2VQYXJ0cyB8fCBzdGFyTWFwKSAmJiBtYXApIHtcbiAgICAgICAgICAgIG5hbWVQYXJ0cyA9IG5hbWUuc3BsaXQoJy8nKTtcblxuICAgICAgICAgICAgZm9yIChpID0gbmFtZVBhcnRzLmxlbmd0aDsgaSA+IDA7IGkgLT0gMSkge1xuICAgICAgICAgICAgICAgIG5hbWVTZWdtZW50ID0gbmFtZVBhcnRzLnNsaWNlKDAsIGkpLmpvaW4oXCIvXCIpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGJhc2VQYXJ0cykge1xuICAgICAgICAgICAgICAgICAgICAvL0ZpbmQgdGhlIGxvbmdlc3QgYmFzZU5hbWUgc2VnbWVudCBtYXRjaCBpbiB0aGUgY29uZmlnLlxuICAgICAgICAgICAgICAgICAgICAvL1NvLCBkbyBqb2lucyBvbiB0aGUgYmlnZ2VzdCB0byBzbWFsbGVzdCBsZW5ndGhzIG9mIGJhc2VQYXJ0cy5cbiAgICAgICAgICAgICAgICAgICAgZm9yIChqID0gYmFzZVBhcnRzLmxlbmd0aDsgaiA+IDA7IGogLT0gMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFwVmFsdWUgPSBtYXBbYmFzZVBhcnRzLnNsaWNlKDAsIGopLmpvaW4oJy8nKV07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vYmFzZU5hbWUgc2VnbWVudCBoYXMgIGNvbmZpZywgZmluZCBpZiBpdCBoYXMgb25lIGZvclxuICAgICAgICAgICAgICAgICAgICAgICAgLy90aGlzIG5hbWUuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobWFwVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXBWYWx1ZSA9IG1hcFZhbHVlW25hbWVTZWdtZW50XTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobWFwVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9NYXRjaCwgdXBkYXRlIG5hbWUgdG8gdGhlIG5ldyB2YWx1ZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRNYXAgPSBtYXBWYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRJID0gaTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kTWFwKSB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vQ2hlY2sgZm9yIGEgc3RhciBtYXAgbWF0Y2gsIGJ1dCBqdXN0IGhvbGQgb24gdG8gaXQsXG4gICAgICAgICAgICAgICAgLy9pZiB0aGVyZSBpcyBhIHNob3J0ZXIgc2VnbWVudCBtYXRjaCBsYXRlciBpbiBhIG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgLy9jb25maWcsIHRoZW4gZmF2b3Igb3ZlciB0aGlzIHN0YXIgbWFwLlxuICAgICAgICAgICAgICAgIGlmICghZm91bmRTdGFyTWFwICYmIHN0YXJNYXAgJiYgc3Rhck1hcFtuYW1lU2VnbWVudF0pIHtcbiAgICAgICAgICAgICAgICAgICAgZm91bmRTdGFyTWFwID0gc3Rhck1hcFtuYW1lU2VnbWVudF07XG4gICAgICAgICAgICAgICAgICAgIHN0YXJJID0gaTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZm91bmRNYXAgJiYgZm91bmRTdGFyTWFwKSB7XG4gICAgICAgICAgICAgICAgZm91bmRNYXAgPSBmb3VuZFN0YXJNYXA7XG4gICAgICAgICAgICAgICAgZm91bmRJID0gc3Rhckk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3VuZE1hcCkge1xuICAgICAgICAgICAgICAgIG5hbWVQYXJ0cy5zcGxpY2UoMCwgZm91bmRJLCBmb3VuZE1hcCk7XG4gICAgICAgICAgICAgICAgbmFtZSA9IG5hbWVQYXJ0cy5qb2luKCcvJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmFtZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtYWtlUmVxdWlyZShyZWxOYW1lLCBmb3JjZVN5bmMpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIC8vQSB2ZXJzaW9uIG9mIGEgcmVxdWlyZSBmdW5jdGlvbiB0aGF0IHBhc3NlcyBhIG1vZHVsZU5hbWVcbiAgICAgICAgICAgIC8vdmFsdWUgZm9yIGl0ZW1zIHRoYXQgbWF5IG5lZWQgdG9cbiAgICAgICAgICAgIC8vbG9vayB1cCBwYXRocyByZWxhdGl2ZSB0byB0aGUgbW9kdWxlTmFtZVxuICAgICAgICAgICAgdmFyIGFyZ3MgPSBhcHMuY2FsbChhcmd1bWVudHMsIDApO1xuXG4gICAgICAgICAgICAvL0lmIGZpcnN0IGFyZyBpcyBub3QgcmVxdWlyZSgnc3RyaW5nJyksIGFuZCB0aGVyZSBpcyBvbmx5XG4gICAgICAgICAgICAvL29uZSBhcmcsIGl0IGlzIHRoZSBhcnJheSBmb3JtIHdpdGhvdXQgYSBjYWxsYmFjay4gSW5zZXJ0XG4gICAgICAgICAgICAvL2EgbnVsbCBzbyB0aGF0IHRoZSBmb2xsb3dpbmcgY29uY2F0IGlzIGNvcnJlY3QuXG4gICAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMF0gIT09ICdzdHJpbmcnICYmIGFyZ3MubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICAgICAgYXJncy5wdXNoKG51bGwpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlcS5hcHBseSh1bmRlZiwgYXJncy5jb25jYXQoW3JlbE5hbWUsIGZvcmNlU3luY10pKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtYWtlTm9ybWFsaXplKHJlbE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplKG5hbWUsIHJlbE5hbWUpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1ha2VMb2FkKGRlcE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgZGVmaW5lZFtkZXBOYW1lXSA9IHZhbHVlO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbGxEZXAobmFtZSkge1xuICAgICAgICBpZiAoaGFzUHJvcCh3YWl0aW5nLCBuYW1lKSkge1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSB3YWl0aW5nW25hbWVdO1xuICAgICAgICAgICAgZGVsZXRlIHdhaXRpbmdbbmFtZV07XG4gICAgICAgICAgICBkZWZpbmluZ1tuYW1lXSA9IHRydWU7XG4gICAgICAgICAgICBtYWluLmFwcGx5KHVuZGVmLCBhcmdzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFzUHJvcChkZWZpbmVkLCBuYW1lKSAmJiAhaGFzUHJvcChkZWZpbmluZywgbmFtZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gJyArIG5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWZpbmVkW25hbWVdO1xuICAgIH1cblxuICAgIC8vVHVybnMgYSBwbHVnaW4hcmVzb3VyY2UgdG8gW3BsdWdpbiwgcmVzb3VyY2VdXG4gICAgLy93aXRoIHRoZSBwbHVnaW4gYmVpbmcgdW5kZWZpbmVkIGlmIHRoZSBuYW1lXG4gICAgLy9kaWQgbm90IGhhdmUgYSBwbHVnaW4gcHJlZml4LlxuICAgIGZ1bmN0aW9uIHNwbGl0UHJlZml4KG5hbWUpIHtcbiAgICAgICAgdmFyIHByZWZpeCxcbiAgICAgICAgICAgIGluZGV4ID0gbmFtZSA/IG5hbWUuaW5kZXhPZignIScpIDogLTE7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICBwcmVmaXggPSBuYW1lLnN1YnN0cmluZygwLCBpbmRleCk7XG4gICAgICAgICAgICBuYW1lID0gbmFtZS5zdWJzdHJpbmcoaW5kZXggKyAxLCBuYW1lLmxlbmd0aCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFtwcmVmaXgsIG5hbWVdO1xuICAgIH1cblxuICAgIC8vQ3JlYXRlcyBhIHBhcnRzIGFycmF5IGZvciBhIHJlbE5hbWUgd2hlcmUgZmlyc3QgcGFydCBpcyBwbHVnaW4gSUQsXG4gICAgLy9zZWNvbmQgcGFydCBpcyByZXNvdXJjZSBJRC4gQXNzdW1lcyByZWxOYW1lIGhhcyBhbHJlYWR5IGJlZW4gbm9ybWFsaXplZC5cbiAgICBmdW5jdGlvbiBtYWtlUmVsUGFydHMocmVsTmFtZSkge1xuICAgICAgICByZXR1cm4gcmVsTmFtZSA/IHNwbGl0UHJlZml4KHJlbE5hbWUpIDogW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTWFrZXMgYSBuYW1lIG1hcCwgbm9ybWFsaXppbmcgdGhlIG5hbWUsIGFuZCB1c2luZyBhIHBsdWdpblxuICAgICAqIGZvciBub3JtYWxpemF0aW9uIGlmIG5lY2Vzc2FyeS4gR3JhYnMgYSByZWYgdG8gcGx1Z2luXG4gICAgICogdG9vLCBhcyBhbiBvcHRpbWl6YXRpb24uXG4gICAgICovXG4gICAgbWFrZU1hcCA9IGZ1bmN0aW9uIChuYW1lLCByZWxQYXJ0cykge1xuICAgICAgICB2YXIgcGx1Z2luLFxuICAgICAgICAgICAgcGFydHMgPSBzcGxpdFByZWZpeChuYW1lKSxcbiAgICAgICAgICAgIHByZWZpeCA9IHBhcnRzWzBdLFxuICAgICAgICAgICAgcmVsUmVzb3VyY2VOYW1lID0gcmVsUGFydHNbMV07XG5cbiAgICAgICAgbmFtZSA9IHBhcnRzWzFdO1xuXG4gICAgICAgIGlmIChwcmVmaXgpIHtcbiAgICAgICAgICAgIHByZWZpeCA9IG5vcm1hbGl6ZShwcmVmaXgsIHJlbFJlc291cmNlTmFtZSk7XG4gICAgICAgICAgICBwbHVnaW4gPSBjYWxsRGVwKHByZWZpeCk7XG4gICAgICAgIH1cblxuICAgICAgICAvL05vcm1hbGl6ZSBhY2NvcmRpbmdcbiAgICAgICAgaWYgKHByZWZpeCkge1xuICAgICAgICAgICAgaWYgKHBsdWdpbiAmJiBwbHVnaW4ubm9ybWFsaXplKSB7XG4gICAgICAgICAgICAgICAgbmFtZSA9IHBsdWdpbi5ub3JtYWxpemUobmFtZSwgbWFrZU5vcm1hbGl6ZShyZWxSZXNvdXJjZU5hbWUpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbmFtZSA9IG5vcm1hbGl6ZShuYW1lLCByZWxSZXNvdXJjZU5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmFtZSA9IG5vcm1hbGl6ZShuYW1lLCByZWxSZXNvdXJjZU5hbWUpO1xuICAgICAgICAgICAgcGFydHMgPSBzcGxpdFByZWZpeChuYW1lKTtcbiAgICAgICAgICAgIHByZWZpeCA9IHBhcnRzWzBdO1xuICAgICAgICAgICAgbmFtZSA9IHBhcnRzWzFdO1xuICAgICAgICAgICAgaWYgKHByZWZpeCkge1xuICAgICAgICAgICAgICAgIHBsdWdpbiA9IGNhbGxEZXAocHJlZml4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vVXNpbmcgcmlkaWN1bG91cyBwcm9wZXJ0eSBuYW1lcyBmb3Igc3BhY2UgcmVhc29uc1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZjogcHJlZml4ID8gcHJlZml4ICsgJyEnICsgbmFtZSA6IG5hbWUsIC8vZnVsbE5hbWVcbiAgICAgICAgICAgIG46IG5hbWUsXG4gICAgICAgICAgICBwcjogcHJlZml4LFxuICAgICAgICAgICAgcDogcGx1Z2luXG4gICAgICAgIH07XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIG1ha2VDb25maWcobmFtZSkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIChjb25maWcgJiYgY29uZmlnLmNvbmZpZyAmJiBjb25maWcuY29uZmlnW25hbWVdKSB8fCB7fTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBoYW5kbGVycyA9IHtcbiAgICAgICAgcmVxdWlyZTogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiBtYWtlUmVxdWlyZShuYW1lKTtcbiAgICAgICAgfSxcbiAgICAgICAgZXhwb3J0czogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHZhciBlID0gZGVmaW5lZFtuYW1lXTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChkZWZpbmVkW25hbWVdID0ge30pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBtb2R1bGU6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGlkOiBuYW1lLFxuICAgICAgICAgICAgICAgIHVyaTogJycsXG4gICAgICAgICAgICAgICAgZXhwb3J0czogZGVmaW5lZFtuYW1lXSxcbiAgICAgICAgICAgICAgICBjb25maWc6IG1ha2VDb25maWcobmFtZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgbWFpbiA9IGZ1bmN0aW9uIChuYW1lLCBkZXBzLCBjYWxsYmFjaywgcmVsTmFtZSkge1xuICAgICAgICB2YXIgY2pzTW9kdWxlLCBkZXBOYW1lLCByZXQsIG1hcCwgaSwgcmVsUGFydHMsXG4gICAgICAgICAgICBhcmdzID0gW10sXG4gICAgICAgICAgICBjYWxsYmFja1R5cGUgPSB0eXBlb2YgY2FsbGJhY2ssXG4gICAgICAgICAgICB1c2luZ0V4cG9ydHM7XG5cbiAgICAgICAgLy9Vc2UgbmFtZSBpZiBubyByZWxOYW1lXG4gICAgICAgIHJlbE5hbWUgPSByZWxOYW1lIHx8IG5hbWU7XG4gICAgICAgIHJlbFBhcnRzID0gbWFrZVJlbFBhcnRzKHJlbE5hbWUpO1xuXG4gICAgICAgIC8vQ2FsbCB0aGUgY2FsbGJhY2sgdG8gZGVmaW5lIHRoZSBtb2R1bGUsIGlmIG5lY2Vzc2FyeS5cbiAgICAgICAgaWYgKGNhbGxiYWNrVHlwZSA9PT0gJ3VuZGVmaW5lZCcgfHwgY2FsbGJhY2tUeXBlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAvL1B1bGwgb3V0IHRoZSBkZWZpbmVkIGRlcGVuZGVuY2llcyBhbmQgcGFzcyB0aGUgb3JkZXJlZFxuICAgICAgICAgICAgLy92YWx1ZXMgdG8gdGhlIGNhbGxiYWNrLlxuICAgICAgICAgICAgLy9EZWZhdWx0IHRvIFtyZXF1aXJlLCBleHBvcnRzLCBtb2R1bGVdIGlmIG5vIGRlcHNcbiAgICAgICAgICAgIGRlcHMgPSAhZGVwcy5sZW5ndGggJiYgY2FsbGJhY2subGVuZ3RoID8gWydyZXF1aXJlJywgJ2V4cG9ydHMnLCAnbW9kdWxlJ10gOiBkZXBzO1xuICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IGRlcHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICBtYXAgPSBtYWtlTWFwKGRlcHNbaV0sIHJlbFBhcnRzKTtcbiAgICAgICAgICAgICAgICBkZXBOYW1lID0gbWFwLmY7XG5cbiAgICAgICAgICAgICAgICAvL0Zhc3QgcGF0aCBDb21tb25KUyBzdGFuZGFyZCBkZXBlbmRlbmNpZXMuXG4gICAgICAgICAgICAgICAgaWYgKGRlcE5hbWUgPT09IFwicmVxdWlyZVwiKSB7XG4gICAgICAgICAgICAgICAgICAgIGFyZ3NbaV0gPSBoYW5kbGVycy5yZXF1aXJlKG5hbWUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZGVwTmFtZSA9PT0gXCJleHBvcnRzXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9Db21tb25KUyBtb2R1bGUgc3BlYyAxLjFcbiAgICAgICAgICAgICAgICAgICAgYXJnc1tpXSA9IGhhbmRsZXJzLmV4cG9ydHMobmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIHVzaW5nRXhwb3J0cyA9IHRydWU7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkZXBOYW1lID09PSBcIm1vZHVsZVwiKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vQ29tbW9uSlMgbW9kdWxlIHNwZWMgMS4xXG4gICAgICAgICAgICAgICAgICAgIGNqc01vZHVsZSA9IGFyZ3NbaV0gPSBoYW5kbGVycy5tb2R1bGUobmFtZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChoYXNQcm9wKGRlZmluZWQsIGRlcE5hbWUpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAgICBoYXNQcm9wKHdhaXRpbmcsIGRlcE5hbWUpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAgICBoYXNQcm9wKGRlZmluaW5nLCBkZXBOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICBhcmdzW2ldID0gY2FsbERlcChkZXBOYW1lKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1hcC5wKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hcC5wLmxvYWQobWFwLm4sIG1ha2VSZXF1aXJlKHJlbE5hbWUsIHRydWUpLCBtYWtlTG9hZChkZXBOYW1lKSwge30pO1xuICAgICAgICAgICAgICAgICAgICBhcmdzW2ldID0gZGVmaW5lZFtkZXBOYW1lXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IobmFtZSArICcgbWlzc2luZyAnICsgZGVwTmFtZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXQgPSBjYWxsYmFjayA/IGNhbGxiYWNrLmFwcGx5KGRlZmluZWRbbmFtZV0sIGFyZ3MpIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBpZiAobmFtZSkge1xuICAgICAgICAgICAgICAgIC8vSWYgc2V0dGluZyBleHBvcnRzIHZpYSBcIm1vZHVsZVwiIGlzIGluIHBsYXksXG4gICAgICAgICAgICAgICAgLy9mYXZvciB0aGF0IG92ZXIgcmV0dXJuIHZhbHVlIGFuZCBleHBvcnRzLiBBZnRlciB0aGF0LFxuICAgICAgICAgICAgICAgIC8vZmF2b3IgYSBub24tdW5kZWZpbmVkIHJldHVybiB2YWx1ZSBvdmVyIGV4cG9ydHMgdXNlLlxuICAgICAgICAgICAgICAgIGlmIChjanNNb2R1bGUgJiYgY2pzTW9kdWxlLmV4cG9ydHMgIT09IHVuZGVmICYmXG4gICAgICAgICAgICAgICAgICAgICAgICBjanNNb2R1bGUuZXhwb3J0cyAhPT0gZGVmaW5lZFtuYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZpbmVkW25hbWVdID0gY2pzTW9kdWxlLmV4cG9ydHM7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXQgIT09IHVuZGVmIHx8ICF1c2luZ0V4cG9ydHMpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9Vc2UgdGhlIHJldHVybiB2YWx1ZSBmcm9tIHRoZSBmdW5jdGlvbi5cbiAgICAgICAgICAgICAgICAgICAgZGVmaW5lZFtuYW1lXSA9IHJldDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobmFtZSkge1xuICAgICAgICAgICAgLy9NYXkganVzdCBiZSBhbiBvYmplY3QgZGVmaW5pdGlvbiBmb3IgdGhlIG1vZHVsZS4gT25seVxuICAgICAgICAgICAgLy93b3JyeSBhYm91dCBkZWZpbmluZyBpZiBoYXZlIGEgbW9kdWxlIG5hbWUuXG4gICAgICAgICAgICBkZWZpbmVkW25hbWVdID0gY2FsbGJhY2s7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgcmVxdWlyZWpzID0gcmVxdWlyZSA9IHJlcSA9IGZ1bmN0aW9uIChkZXBzLCBjYWxsYmFjaywgcmVsTmFtZSwgZm9yY2VTeW5jLCBhbHQpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBkZXBzID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBpZiAoaGFuZGxlcnNbZGVwc10pIHtcbiAgICAgICAgICAgICAgICAvL2NhbGxiYWNrIGluIHRoaXMgY2FzZSBpcyByZWFsbHkgcmVsTmFtZVxuICAgICAgICAgICAgICAgIHJldHVybiBoYW5kbGVyc1tkZXBzXShjYWxsYmFjayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL0p1c3QgcmV0dXJuIHRoZSBtb2R1bGUgd2FudGVkLiBJbiB0aGlzIHNjZW5hcmlvLCB0aGVcbiAgICAgICAgICAgIC8vZGVwcyBhcmcgaXMgdGhlIG1vZHVsZSBuYW1lLCBhbmQgc2Vjb25kIGFyZyAoaWYgcGFzc2VkKVxuICAgICAgICAgICAgLy9pcyBqdXN0IHRoZSByZWxOYW1lLlxuICAgICAgICAgICAgLy9Ob3JtYWxpemUgbW9kdWxlIG5hbWUsIGlmIGl0IGNvbnRhaW5zIC4gb3IgLi5cbiAgICAgICAgICAgIHJldHVybiBjYWxsRGVwKG1ha2VNYXAoZGVwcywgbWFrZVJlbFBhcnRzKGNhbGxiYWNrKSkuZik7XG4gICAgICAgIH0gZWxzZSBpZiAoIWRlcHMuc3BsaWNlKSB7XG4gICAgICAgICAgICAvL2RlcHMgaXMgYSBjb25maWcgb2JqZWN0LCBub3QgYW4gYXJyYXkuXG4gICAgICAgICAgICBjb25maWcgPSBkZXBzO1xuICAgICAgICAgICAgaWYgKGNvbmZpZy5kZXBzKSB7XG4gICAgICAgICAgICAgICAgcmVxKGNvbmZpZy5kZXBzLCBjb25maWcuY2FsbGJhY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNhbGxiYWNrLnNwbGljZSkge1xuICAgICAgICAgICAgICAgIC8vY2FsbGJhY2sgaXMgYW4gYXJyYXksIHdoaWNoIG1lYW5zIGl0IGlzIGEgZGVwZW5kZW5jeSBsaXN0LlxuICAgICAgICAgICAgICAgIC8vQWRqdXN0IGFyZ3MgaWYgdGhlcmUgYXJlIGRlcGVuZGVuY2llc1xuICAgICAgICAgICAgICAgIGRlcHMgPSBjYWxsYmFjaztcbiAgICAgICAgICAgICAgICBjYWxsYmFjayA9IHJlbE5hbWU7XG4gICAgICAgICAgICAgICAgcmVsTmFtZSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGRlcHMgPSB1bmRlZjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vU3VwcG9ydCByZXF1aXJlKFsnYSddKVxuICAgICAgICBjYWxsYmFjayA9IGNhbGxiYWNrIHx8IGZ1bmN0aW9uICgpIHt9O1xuXG4gICAgICAgIC8vSWYgcmVsTmFtZSBpcyBhIGZ1bmN0aW9uLCBpdCBpcyBhbiBlcnJiYWNrIGhhbmRsZXIsXG4gICAgICAgIC8vc28gcmVtb3ZlIGl0LlxuICAgICAgICBpZiAodHlwZW9mIHJlbE5hbWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHJlbE5hbWUgPSBmb3JjZVN5bmM7XG4gICAgICAgICAgICBmb3JjZVN5bmMgPSBhbHQ7XG4gICAgICAgIH1cblxuICAgICAgICAvL1NpbXVsYXRlIGFzeW5jIGNhbGxiYWNrO1xuICAgICAgICBpZiAoZm9yY2VTeW5jKSB7XG4gICAgICAgICAgICBtYWluKHVuZGVmLCBkZXBzLCBjYWxsYmFjaywgcmVsTmFtZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvL1VzaW5nIGEgbm9uLXplcm8gdmFsdWUgYmVjYXVzZSBvZiBjb25jZXJuIGZvciB3aGF0IG9sZCBicm93c2Vyc1xuICAgICAgICAgICAgLy9kbywgYW5kIGxhdGVzdCBicm93c2VycyBcInVwZ3JhZGVcIiB0byA0IGlmIGxvd2VyIHZhbHVlIGlzIHVzZWQ6XG4gICAgICAgICAgICAvL2h0dHA6Ly93d3cud2hhdHdnLm9yZy9zcGVjcy93ZWItYXBwcy9jdXJyZW50LXdvcmsvbXVsdGlwYWdlL3RpbWVycy5odG1sI2RvbS13aW5kb3d0aW1lcnMtc2V0dGltZW91dDpcbiAgICAgICAgICAgIC8vSWYgd2FudCBhIHZhbHVlIGltbWVkaWF0ZWx5LCB1c2UgcmVxdWlyZSgnaWQnKSBpbnN0ZWFkIC0tIHNvbWV0aGluZ1xuICAgICAgICAgICAgLy90aGF0IHdvcmtzIGluIGFsbW9uZCBvbiB0aGUgZ2xvYmFsIGxldmVsLCBidXQgbm90IGd1YXJhbnRlZWQgYW5kXG4gICAgICAgICAgICAvL3VubGlrZWx5IHRvIHdvcmsgaW4gb3RoZXIgQU1EIGltcGxlbWVudGF0aW9ucy5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG1haW4odW5kZWYsIGRlcHMsIGNhbGxiYWNrLCByZWxOYW1lKTtcbiAgICAgICAgICAgIH0sIDQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogSnVzdCBkcm9wcyB0aGUgY29uZmlnIG9uIHRoZSBmbG9vciwgYnV0IHJldHVybnMgcmVxIGluIGNhc2VcbiAgICAgKiB0aGUgY29uZmlnIHJldHVybiB2YWx1ZSBpcyB1c2VkLlxuICAgICAqL1xuICAgIHJlcS5jb25maWcgPSBmdW5jdGlvbiAoY2ZnKSB7XG4gICAgICAgIHJldHVybiByZXEoY2ZnKTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogRXhwb3NlIG1vZHVsZSByZWdpc3RyeSBmb3IgZGVidWdnaW5nIGFuZCB0b29saW5nXG4gICAgICovXG4gICAgcmVxdWlyZWpzLl9kZWZpbmVkID0gZGVmaW5lZDtcblxuICAgIGRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXBzLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlZSBhbG1vbmQgUkVBRE1FOiBpbmNvcnJlY3QgbW9kdWxlIGJ1aWxkLCBubyBtb2R1bGUgbmFtZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy9UaGlzIG1vZHVsZSBtYXkgbm90IGhhdmUgZGVwZW5kZW5jaWVzXG4gICAgICAgIGlmICghZGVwcy5zcGxpY2UpIHtcbiAgICAgICAgICAgIC8vZGVwcyBpcyBub3QgYW4gYXJyYXksIHNvIHByb2JhYmx5IG1lYW5zXG4gICAgICAgICAgICAvL2FuIG9iamVjdCBsaXRlcmFsIG9yIGZhY3RvcnkgZnVuY3Rpb24gZm9yXG4gICAgICAgICAgICAvL3RoZSB2YWx1ZS4gQWRqdXN0IGFyZ3MuXG4gICAgICAgICAgICBjYWxsYmFjayA9IGRlcHM7XG4gICAgICAgICAgICBkZXBzID0gW107XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhc1Byb3AoZGVmaW5lZCwgbmFtZSkgJiYgIWhhc1Byb3Aod2FpdGluZywgbmFtZSkpIHtcbiAgICAgICAgICAgIHdhaXRpbmdbbmFtZV0gPSBbbmFtZSwgZGVwcywgY2FsbGJhY2tdO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGRlZmluZS5hbWQgPSB7XG4gICAgICAgIGpRdWVyeTogdHJ1ZVxuICAgIH07XG59KCkpO1xuXG5kZWZpbmUoXCJhbG1vbmRcIiwgZnVuY3Rpb24oKXt9KTtcblxuIiwiLyoqXHJcbiAqIGpzY29sb3IgLSBKYXZhU2NyaXB0IENvbG9yIFBpY2tlclxyXG4gKlxyXG4gKiBAbGluayAgICBodHRwOi8vanNjb2xvci5jb21cclxuICogQGxpY2Vuc2UgRm9yIG9wZW4gc291cmNlIHVzZTogR1BMdjNcclxuICogICAgICAgICAgRm9yIGNvbW1lcmNpYWwgdXNlOiBKU0NvbG9yIENvbW1lcmNpYWwgTGljZW5zZVxyXG4gKiBAYXV0aG9yICBKYW4gT2R2YXJrb1xyXG4gKiBAdmVyc2lvbiAyLjAuNFxyXG4gKlxyXG4gKiBTZWUgdXNhZ2UgZXhhbXBsZXMgYXQgaHR0cDovL2pzY29sb3IuY29tL2V4YW1wbGVzL1xyXG4gKi9cclxuXHJcblxyXG5kZWZpbmUoJ2pzY29sb3InLFtdLCBmdW5jdGlvbigpIHtcclxuXHJcbnZhciBqc2MgPSB7XHJcblxyXG5cclxuXHRyZWdpc3RlciA6IGZ1bmN0aW9uICgpIHtcclxuXHRcdGpzYy5hdHRhY2hET01SZWFkeUV2ZW50KGpzYy5pbml0KTtcclxuXHRcdGpzYy5hdHRhY2hFdmVudChkb2N1bWVudCwgJ21vdXNlZG93bicsIGpzYy5vbkRvY3VtZW50TW91c2VEb3duKTtcclxuXHRcdGpzYy5hdHRhY2hFdmVudChkb2N1bWVudCwgJ3RvdWNoc3RhcnQnLCBqc2Mub25Eb2N1bWVudFRvdWNoU3RhcnQpO1xyXG5cdFx0anNjLmF0dGFjaEV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIGpzYy5vbldpbmRvd1Jlc2l6ZSk7XHJcblx0fSxcclxuXHJcblxyXG5cdGluaXQgOiBmdW5jdGlvbiAoKSB7XHJcblx0XHRpZiAoanNjLmpzY29sb3IubG9va3VwQ2xhc3MpIHtcclxuXHRcdFx0anNjLmpzY29sb3IuaW5zdGFsbEJ5Q2xhc3NOYW1lKGpzYy5qc2NvbG9yLmxvb2t1cENsYXNzKTtcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0dHJ5SW5zdGFsbE9uRWxlbWVudHMgOiBmdW5jdGlvbiAoZWxtcywgY2xhc3NOYW1lKSB7XHJcblx0XHR2YXIgbWF0Y2hDbGFzcyA9IG5ldyBSZWdFeHAoJyhefFxcXFxzKSgnICsgY2xhc3NOYW1lICsgJykoXFxcXHMqKFxcXFx7W159XSpcXFxcfSl8XFxcXHN8JCknLCAnaScpO1xyXG5cclxuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgZWxtcy5sZW5ndGg7IGkgKz0gMSkge1xyXG5cdFx0XHRpZiAoZWxtc1tpXS50eXBlICE9PSB1bmRlZmluZWQgJiYgZWxtc1tpXS50eXBlLnRvTG93ZXJDYXNlKCkgPT0gJ2NvbG9yJykge1xyXG5cdFx0XHRcdGlmIChqc2MuaXNDb2xvckF0dHJTdXBwb3J0ZWQpIHtcclxuXHRcdFx0XHRcdC8vIHNraXAgaW5wdXRzIG9mIHR5cGUgJ2NvbG9yJyBpZiBzdXBwb3J0ZWQgYnkgdGhlIGJyb3dzZXJcclxuXHRcdFx0XHRcdGNvbnRpbnVlO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XHR2YXIgbTtcclxuXHRcdFx0aWYgKCFlbG1zW2ldLmpzY29sb3IgJiYgZWxtc1tpXS5jbGFzc05hbWUgJiYgKG0gPSBlbG1zW2ldLmNsYXNzTmFtZS5tYXRjaChtYXRjaENsYXNzKSkpIHtcclxuXHRcdFx0XHR2YXIgdGFyZ2V0RWxtID0gZWxtc1tpXTtcclxuXHRcdFx0XHR2YXIgb3B0c1N0ciA9IG51bGw7XHJcblxyXG5cdFx0XHRcdHZhciBkYXRhT3B0aW9ucyA9IGpzYy5nZXREYXRhQXR0cih0YXJnZXRFbG0sICdqc2NvbG9yJyk7XHJcblx0XHRcdFx0aWYgKGRhdGFPcHRpb25zICE9PSBudWxsKSB7XHJcblx0XHRcdFx0XHRvcHRzU3RyID0gZGF0YU9wdGlvbnM7XHJcblx0XHRcdFx0fSBlbHNlIGlmIChtWzRdKSB7XHJcblx0XHRcdFx0XHRvcHRzU3RyID0gbVs0XTtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdHZhciBvcHRzID0ge307XHJcblx0XHRcdFx0aWYgKG9wdHNTdHIpIHtcclxuXHRcdFx0XHRcdHRyeSB7XHJcblx0XHRcdFx0XHRcdG9wdHMgPSAobmV3IEZ1bmN0aW9uICgncmV0dXJuICgnICsgb3B0c1N0ciArICcpJykpKCk7XHJcblx0XHRcdFx0XHR9IGNhdGNoKGVQYXJzZUVycm9yKSB7XHJcblx0XHRcdFx0XHRcdGpzYy53YXJuKCdFcnJvciBwYXJzaW5nIGpzY29sb3Igb3B0aW9uczogJyArIGVQYXJzZUVycm9yICsgJzpcXG4nICsgb3B0c1N0cik7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdHRhcmdldEVsbS5qc2NvbG9yID0gbmV3IGpzYy5qc2NvbG9yKHRhcmdldEVsbSwgb3B0cyk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0aXNDb2xvckF0dHJTdXBwb3J0ZWQgOiAoZnVuY3Rpb24gKCkge1xyXG5cdFx0dmFyIGVsbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XHJcblx0XHRpZiAoZWxtLnNldEF0dHJpYnV0ZSkge1xyXG5cdFx0XHRlbG0uc2V0QXR0cmlidXRlKCd0eXBlJywgJ2NvbG9yJyk7XHJcblx0XHRcdGlmIChlbG0udHlwZS50b0xvd2VyQ2FzZSgpID09ICdjb2xvcicpIHtcclxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH0pKCksXHJcblxyXG5cclxuXHRpc0NhbnZhc1N1cHBvcnRlZCA6IChmdW5jdGlvbiAoKSB7XHJcblx0XHR2YXIgZWxtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcblx0XHRyZXR1cm4gISEoZWxtLmdldENvbnRleHQgJiYgZWxtLmdldENvbnRleHQoJzJkJykpO1xyXG5cdH0pKCksXHJcblxyXG5cclxuXHRmZXRjaEVsZW1lbnQgOiBmdW5jdGlvbiAobWl4ZWQpIHtcclxuXHRcdHJldHVybiB0eXBlb2YgbWl4ZWQgPT09ICdzdHJpbmcnID8gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQobWl4ZWQpIDogbWl4ZWQ7XHJcblx0fSxcclxuXHJcblxyXG5cdGlzRWxlbWVudFR5cGUgOiBmdW5jdGlvbiAoZWxtLCB0eXBlKSB7XHJcblx0XHRyZXR1cm4gZWxtLm5vZGVOYW1lLnRvTG93ZXJDYXNlKCkgPT09IHR5cGUudG9Mb3dlckNhc2UoKTtcclxuXHR9LFxyXG5cclxuXHJcblx0Z2V0RGF0YUF0dHIgOiBmdW5jdGlvbiAoZWwsIG5hbWUpIHtcclxuXHRcdHZhciBhdHRyTmFtZSA9ICdkYXRhLScgKyBuYW1lO1xyXG5cdFx0dmFyIGF0dHJWYWx1ZSA9IGVsLmdldEF0dHJpYnV0ZShhdHRyTmFtZSk7XHJcblx0XHRpZiAoYXR0clZhbHVlICE9PSBudWxsKSB7XHJcblx0XHRcdHJldHVybiBhdHRyVmFsdWU7XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9LFxyXG5cclxuXHJcblx0YXR0YWNoRXZlbnQgOiBmdW5jdGlvbiAoZWwsIGV2bnQsIGZ1bmMpIHtcclxuXHRcdGlmIChlbC5hZGRFdmVudExpc3RlbmVyKSB7XHJcblx0XHRcdGVsLmFkZEV2ZW50TGlzdGVuZXIoZXZudCwgZnVuYywgZmFsc2UpO1xyXG5cdFx0fSBlbHNlIGlmIChlbC5hdHRhY2hFdmVudCkge1xyXG5cdFx0XHRlbC5hdHRhY2hFdmVudCgnb24nICsgZXZudCwgZnVuYyk7XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdGRldGFjaEV2ZW50IDogZnVuY3Rpb24gKGVsLCBldm50LCBmdW5jKSB7XHJcblx0XHRpZiAoZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcikge1xyXG5cdFx0XHRlbC5yZW1vdmVFdmVudExpc3RlbmVyKGV2bnQsIGZ1bmMsIGZhbHNlKTtcclxuXHRcdH0gZWxzZSBpZiAoZWwuZGV0YWNoRXZlbnQpIHtcclxuXHRcdFx0ZWwuZGV0YWNoRXZlbnQoJ29uJyArIGV2bnQsIGZ1bmMpO1xyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRfYXR0YWNoZWRHcm91cEV2ZW50cyA6IHt9LFxyXG5cclxuXHJcblx0YXR0YWNoR3JvdXBFdmVudCA6IGZ1bmN0aW9uIChncm91cE5hbWUsIGVsLCBldm50LCBmdW5jKSB7XHJcblx0XHRpZiAoIWpzYy5fYXR0YWNoZWRHcm91cEV2ZW50cy5oYXNPd25Qcm9wZXJ0eShncm91cE5hbWUpKSB7XHJcblx0XHRcdGpzYy5fYXR0YWNoZWRHcm91cEV2ZW50c1tncm91cE5hbWVdID0gW107XHJcblx0XHR9XHJcblx0XHRqc2MuX2F0dGFjaGVkR3JvdXBFdmVudHNbZ3JvdXBOYW1lXS5wdXNoKFtlbCwgZXZudCwgZnVuY10pO1xyXG5cdFx0anNjLmF0dGFjaEV2ZW50KGVsLCBldm50LCBmdW5jKTtcclxuXHR9LFxyXG5cclxuXHJcblx0ZGV0YWNoR3JvdXBFdmVudHMgOiBmdW5jdGlvbiAoZ3JvdXBOYW1lKSB7XHJcblx0XHRpZiAoanNjLl9hdHRhY2hlZEdyb3VwRXZlbnRzLmhhc093blByb3BlcnR5KGdyb3VwTmFtZSkpIHtcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBqc2MuX2F0dGFjaGVkR3JvdXBFdmVudHNbZ3JvdXBOYW1lXS5sZW5ndGg7IGkgKz0gMSkge1xyXG5cdFx0XHRcdHZhciBldnQgPSBqc2MuX2F0dGFjaGVkR3JvdXBFdmVudHNbZ3JvdXBOYW1lXVtpXTtcclxuXHRcdFx0XHRqc2MuZGV0YWNoRXZlbnQoZXZ0WzBdLCBldnRbMV0sIGV2dFsyXSk7XHJcblx0XHRcdH1cclxuXHRcdFx0ZGVsZXRlIGpzYy5fYXR0YWNoZWRHcm91cEV2ZW50c1tncm91cE5hbWVdO1xyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRhdHRhY2hET01SZWFkeUV2ZW50IDogZnVuY3Rpb24gKGZ1bmMpIHtcclxuXHRcdHZhciBmaXJlZCA9IGZhbHNlO1xyXG5cdFx0dmFyIGZpcmVPbmNlID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRpZiAoIWZpcmVkKSB7XHJcblx0XHRcdFx0ZmlyZWQgPSB0cnVlO1xyXG5cdFx0XHRcdGZ1bmMoKTtcclxuXHRcdFx0fVxyXG5cdFx0fTtcclxuXHJcblx0XHRpZiAoZG9jdW1lbnQucmVhZHlTdGF0ZSA9PT0gJ2NvbXBsZXRlJykge1xyXG5cdFx0XHRzZXRUaW1lb3V0KGZpcmVPbmNlLCAxKTsgLy8gYXN5bmNcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cclxuXHRcdGlmIChkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKSB7XHJcblx0XHRcdGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCBmaXJlT25jZSwgZmFsc2UpO1xyXG5cclxuXHRcdFx0Ly8gRmFsbGJhY2tcclxuXHRcdFx0d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBmaXJlT25jZSwgZmFsc2UpO1xyXG5cclxuXHRcdH0gZWxzZSBpZiAoZG9jdW1lbnQuYXR0YWNoRXZlbnQpIHtcclxuXHRcdFx0Ly8gSUVcclxuXHRcdFx0ZG9jdW1lbnQuYXR0YWNoRXZlbnQoJ29ucmVhZHlzdGF0ZWNoYW5nZScsIGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0XHRpZiAoZG9jdW1lbnQucmVhZHlTdGF0ZSA9PT0gJ2NvbXBsZXRlJykge1xyXG5cdFx0XHRcdFx0ZG9jdW1lbnQuZGV0YWNoRXZlbnQoJ29ucmVhZHlzdGF0ZWNoYW5nZScsIGFyZ3VtZW50cy5jYWxsZWUpO1xyXG5cdFx0XHRcdFx0ZmlyZU9uY2UoKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH0pXHJcblxyXG5cdFx0XHQvLyBGYWxsYmFja1xyXG5cdFx0XHR3aW5kb3cuYXR0YWNoRXZlbnQoJ29ubG9hZCcsIGZpcmVPbmNlKTtcclxuXHJcblx0XHRcdC8vIElFNy84XHJcblx0XHRcdGlmIChkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuZG9TY3JvbGwgJiYgd2luZG93ID09IHdpbmRvdy50b3ApIHtcclxuXHRcdFx0XHR2YXIgdHJ5U2Nyb2xsID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0aWYgKCFkb2N1bWVudC5ib2R5KSB7IHJldHVybjsgfVxyXG5cdFx0XHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRcdFx0ZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsKCdsZWZ0Jyk7XHJcblx0XHRcdFx0XHRcdGZpcmVPbmNlKCk7XHJcblx0XHRcdFx0XHR9IGNhdGNoIChlKSB7XHJcblx0XHRcdFx0XHRcdHNldFRpbWVvdXQodHJ5U2Nyb2xsLCAxKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9O1xyXG5cdFx0XHRcdHRyeVNjcm9sbCgpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdHdhcm4gOiBmdW5jdGlvbiAobXNnKSB7XHJcblx0XHRpZiAod2luZG93LmNvbnNvbGUgJiYgd2luZG93LmNvbnNvbGUud2Fybikge1xyXG5cdFx0XHR3aW5kb3cuY29uc29sZS53YXJuKG1zZyk7XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdHByZXZlbnREZWZhdWx0IDogZnVuY3Rpb24gKGUpIHtcclxuXHRcdGlmIChlLnByZXZlbnREZWZhdWx0KSB7IGUucHJldmVudERlZmF1bHQoKTsgfVxyXG5cdFx0ZS5yZXR1cm5WYWx1ZSA9IGZhbHNlO1xyXG5cdH0sXHJcblxyXG5cclxuXHRjYXB0dXJlVGFyZ2V0IDogZnVuY3Rpb24gKHRhcmdldCkge1xyXG5cdFx0Ly8gSUVcclxuXHRcdGlmICh0YXJnZXQuc2V0Q2FwdHVyZSkge1xyXG5cdFx0XHRqc2MuX2NhcHR1cmVkVGFyZ2V0ID0gdGFyZ2V0O1xyXG5cdFx0XHRqc2MuX2NhcHR1cmVkVGFyZ2V0LnNldENhcHR1cmUoKTtcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0cmVsZWFzZVRhcmdldCA6IGZ1bmN0aW9uICgpIHtcclxuXHRcdC8vIElFXHJcblx0XHRpZiAoanNjLl9jYXB0dXJlZFRhcmdldCkge1xyXG5cdFx0XHRqc2MuX2NhcHR1cmVkVGFyZ2V0LnJlbGVhc2VDYXB0dXJlKCk7XHJcblx0XHRcdGpzYy5fY2FwdHVyZWRUYXJnZXQgPSBudWxsO1xyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRmaXJlRXZlbnQgOiBmdW5jdGlvbiAoZWwsIGV2bnQpIHtcclxuXHRcdGlmICghZWwpIHtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cdFx0aWYgKGRvY3VtZW50LmNyZWF0ZUV2ZW50KSB7XHJcblx0XHRcdHZhciBldiA9IGRvY3VtZW50LmNyZWF0ZUV2ZW50KCdIVE1MRXZlbnRzJyk7XHJcblx0XHRcdGV2LmluaXRFdmVudChldm50LCB0cnVlLCB0cnVlKTtcclxuXHRcdFx0ZWwuZGlzcGF0Y2hFdmVudChldik7XHJcblx0XHR9IGVsc2UgaWYgKGRvY3VtZW50LmNyZWF0ZUV2ZW50T2JqZWN0KSB7XHJcblx0XHRcdHZhciBldiA9IGRvY3VtZW50LmNyZWF0ZUV2ZW50T2JqZWN0KCk7XHJcblx0XHRcdGVsLmZpcmVFdmVudCgnb24nICsgZXZudCwgZXYpO1xyXG5cdFx0fSBlbHNlIGlmIChlbFsnb24nICsgZXZudF0pIHsgLy8gYWx0ZXJuYXRpdmVseSB1c2UgdGhlIHRyYWRpdGlvbmFsIGV2ZW50IG1vZGVsXHJcblx0XHRcdGVsWydvbicgKyBldm50XSgpO1xyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRjbGFzc05hbWVUb0xpc3QgOiBmdW5jdGlvbiAoY2xhc3NOYW1lKSB7XHJcblx0XHRyZXR1cm4gY2xhc3NOYW1lLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKS5zcGxpdCgvXFxzKy8pO1xyXG5cdH0sXHJcblxyXG5cclxuXHQvLyBUaGUgY2xhc3NOYW1lIHBhcmFtZXRlciAoc3RyKSBjYW4gb25seSBjb250YWluIGEgc2luZ2xlIGNsYXNzIG5hbWVcclxuXHRoYXNDbGFzcyA6IGZ1bmN0aW9uIChlbG0sIGNsYXNzTmFtZSkge1xyXG5cdFx0aWYgKCFjbGFzc05hbWUpIHtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIC0xICE9ICgnICcgKyBlbG0uY2xhc3NOYW1lLnJlcGxhY2UoL1xccysvZywgJyAnKSArICcgJykuaW5kZXhPZignICcgKyBjbGFzc05hbWUgKyAnICcpO1xyXG5cdH0sXHJcblxyXG5cclxuXHQvLyBUaGUgY2xhc3NOYW1lIHBhcmFtZXRlciAoc3RyKSBjYW4gY29udGFpbiBtdWx0aXBsZSBjbGFzcyBuYW1lcyBzZXBhcmF0ZWQgYnkgd2hpdGVzcGFjZVxyXG5cdHNldENsYXNzIDogZnVuY3Rpb24gKGVsbSwgY2xhc3NOYW1lKSB7XHJcblx0XHR2YXIgY2xhc3NMaXN0ID0ganNjLmNsYXNzTmFtZVRvTGlzdChjbGFzc05hbWUpO1xyXG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBjbGFzc0xpc3QubGVuZ3RoOyBpICs9IDEpIHtcclxuXHRcdFx0aWYgKCFqc2MuaGFzQ2xhc3MoZWxtLCBjbGFzc0xpc3RbaV0pKSB7XHJcblx0XHRcdFx0ZWxtLmNsYXNzTmFtZSArPSAoZWxtLmNsYXNzTmFtZSA/ICcgJyA6ICcnKSArIGNsYXNzTGlzdFtpXTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHQvLyBUaGUgY2xhc3NOYW1lIHBhcmFtZXRlciAoc3RyKSBjYW4gY29udGFpbiBtdWx0aXBsZSBjbGFzcyBuYW1lcyBzZXBhcmF0ZWQgYnkgd2hpdGVzcGFjZVxyXG5cdHVuc2V0Q2xhc3MgOiBmdW5jdGlvbiAoZWxtLCBjbGFzc05hbWUpIHtcclxuXHRcdHZhciBjbGFzc0xpc3QgPSBqc2MuY2xhc3NOYW1lVG9MaXN0KGNsYXNzTmFtZSk7XHJcblx0XHRmb3IgKHZhciBpID0gMDsgaSA8IGNsYXNzTGlzdC5sZW5ndGg7IGkgKz0gMSkge1xyXG5cdFx0XHR2YXIgcmVwbCA9IG5ldyBSZWdFeHAoXHJcblx0XHRcdFx0J15cXFxccyonICsgY2xhc3NMaXN0W2ldICsgJ1xcXFxzKnwnICtcclxuXHRcdFx0XHQnXFxcXHMqJyArIGNsYXNzTGlzdFtpXSArICdcXFxccyokfCcgK1xyXG5cdFx0XHRcdCdcXFxccysnICsgY2xhc3NMaXN0W2ldICsgJyhcXFxccyspJyxcclxuXHRcdFx0XHQnZydcclxuXHRcdFx0KTtcclxuXHRcdFx0ZWxtLmNsYXNzTmFtZSA9IGVsbS5jbGFzc05hbWUucmVwbGFjZShyZXBsLCAnJDEnKTtcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0Z2V0U3R5bGUgOiBmdW5jdGlvbiAoZWxtKSB7XHJcblx0XHRyZXR1cm4gd2luZG93LmdldENvbXB1dGVkU3R5bGUgPyB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbG0pIDogZWxtLmN1cnJlbnRTdHlsZTtcclxuXHR9LFxyXG5cclxuXHJcblx0c2V0U3R5bGUgOiAoZnVuY3Rpb24gKCkge1xyXG5cdFx0dmFyIGhlbHBlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG5cdFx0dmFyIGdldFN1cHBvcnRlZFByb3AgPSBmdW5jdGlvbiAobmFtZXMpIHtcclxuXHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBuYW1lcy5sZW5ndGg7IGkgKz0gMSkge1xyXG5cdFx0XHRcdGlmIChuYW1lc1tpXSBpbiBoZWxwZXIuc3R5bGUpIHtcclxuXHRcdFx0XHRcdHJldHVybiBuYW1lc1tpXTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblx0XHR2YXIgcHJvcHMgPSB7XHJcblx0XHRcdGJvcmRlclJhZGl1czogZ2V0U3VwcG9ydGVkUHJvcChbJ2JvcmRlclJhZGl1cycsICdNb3pCb3JkZXJSYWRpdXMnLCAnd2Via2l0Qm9yZGVyUmFkaXVzJ10pLFxyXG5cdFx0XHRib3hTaGFkb3c6IGdldFN1cHBvcnRlZFByb3AoWydib3hTaGFkb3cnLCAnTW96Qm94U2hhZG93JywgJ3dlYmtpdEJveFNoYWRvdyddKVxyXG5cdFx0fTtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoZWxtLCBwcm9wLCB2YWx1ZSkge1xyXG5cdFx0XHRzd2l0Y2ggKHByb3AudG9Mb3dlckNhc2UoKSkge1xyXG5cdFx0XHRjYXNlICdvcGFjaXR5JzpcclxuXHRcdFx0XHR2YXIgYWxwaGFPcGFjaXR5ID0gTWF0aC5yb3VuZChwYXJzZUZsb2F0KHZhbHVlKSAqIDEwMCk7XHJcblx0XHRcdFx0ZWxtLnN0eWxlLm9wYWNpdHkgPSB2YWx1ZTtcclxuXHRcdFx0XHRlbG0uc3R5bGUuZmlsdGVyID0gJ2FscGhhKG9wYWNpdHk9JyArIGFscGhhT3BhY2l0eSArICcpJztcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0ZGVmYXVsdDpcclxuXHRcdFx0XHRlbG0uc3R5bGVbcHJvcHNbcHJvcF1dID0gdmFsdWU7XHJcblx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblx0fSkoKSxcclxuXHJcblxyXG5cdHNldEJvcmRlclJhZGl1cyA6IGZ1bmN0aW9uIChlbG0sIHZhbHVlKSB7XHJcblx0XHRqc2Muc2V0U3R5bGUoZWxtLCAnYm9yZGVyUmFkaXVzJywgdmFsdWUgfHwgJzAnKTtcclxuXHR9LFxyXG5cclxuXHJcblx0c2V0Qm94U2hhZG93IDogZnVuY3Rpb24gKGVsbSwgdmFsdWUpIHtcclxuXHRcdGpzYy5zZXRTdHlsZShlbG0sICdib3hTaGFkb3cnLCB2YWx1ZSB8fCAnbm9uZScpO1xyXG5cdH0sXHJcblxyXG5cclxuXHRnZXRFbGVtZW50UG9zIDogZnVuY3Rpb24gKGUsIHJlbGF0aXZlVG9WaWV3cG9ydCkge1xyXG5cdFx0dmFyIHg9MCwgeT0wO1xyXG5cdFx0dmFyIHJlY3QgPSBlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG5cdFx0eCA9IHJlY3QubGVmdDtcclxuXHRcdHkgPSByZWN0LnRvcDtcclxuXHRcdGlmICghcmVsYXRpdmVUb1ZpZXdwb3J0KSB7XHJcblx0XHRcdHZhciB2aWV3UG9zID0ganNjLmdldFZpZXdQb3MoKTtcclxuXHRcdFx0eCArPSB2aWV3UG9zWzBdO1xyXG5cdFx0XHR5ICs9IHZpZXdQb3NbMV07XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gW3gsIHldO1xyXG5cdH0sXHJcblxyXG5cclxuXHRnZXRFbGVtZW50U2l6ZSA6IGZ1bmN0aW9uIChlKSB7XHJcblx0XHRyZXR1cm4gW2Uub2Zmc2V0V2lkdGgsIGUub2Zmc2V0SGVpZ2h0XTtcclxuXHR9LFxyXG5cclxuXHJcblx0Ly8gZ2V0IHBvaW50ZXIncyBYL1kgY29vcmRpbmF0ZXMgcmVsYXRpdmUgdG8gdmlld3BvcnRcclxuXHRnZXRBYnNQb2ludGVyUG9zIDogZnVuY3Rpb24gKGUpIHtcclxuXHRcdGlmICghZSkgeyBlID0gd2luZG93LmV2ZW50OyB9XHJcblx0XHR2YXIgeCA9IDAsIHkgPSAwO1xyXG5cdFx0aWYgKHR5cGVvZiBlLmNoYW5nZWRUb3VjaGVzICE9PSAndW5kZWZpbmVkJyAmJiBlLmNoYW5nZWRUb3VjaGVzLmxlbmd0aCkge1xyXG5cdFx0XHQvLyB0b3VjaCBkZXZpY2VzXHJcblx0XHRcdHggPSBlLmNoYW5nZWRUb3VjaGVzWzBdLmNsaWVudFg7XHJcblx0XHRcdHkgPSBlLmNoYW5nZWRUb3VjaGVzWzBdLmNsaWVudFk7XHJcblx0XHR9IGVsc2UgaWYgKHR5cGVvZiBlLmNsaWVudFggPT09ICdudW1iZXInKSB7XHJcblx0XHRcdHggPSBlLmNsaWVudFg7XHJcblx0XHRcdHkgPSBlLmNsaWVudFk7XHJcblx0XHR9XHJcblx0XHRyZXR1cm4geyB4OiB4LCB5OiB5IH07XHJcblx0fSxcclxuXHJcblxyXG5cdC8vIGdldCBwb2ludGVyJ3MgWC9ZIGNvb3JkaW5hdGVzIHJlbGF0aXZlIHRvIHRhcmdldCBlbGVtZW50XHJcblx0Z2V0UmVsUG9pbnRlclBvcyA6IGZ1bmN0aW9uIChlKSB7XHJcblx0XHRpZiAoIWUpIHsgZSA9IHdpbmRvdy5ldmVudDsgfVxyXG5cdFx0dmFyIHRhcmdldCA9IGUudGFyZ2V0IHx8IGUuc3JjRWxlbWVudDtcclxuXHRcdHZhciB0YXJnZXRSZWN0ID0gdGFyZ2V0LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG5cclxuXHRcdHZhciB4ID0gMCwgeSA9IDA7XHJcblxyXG5cdFx0dmFyIGNsaWVudFggPSAwLCBjbGllbnRZID0gMDtcclxuXHRcdGlmICh0eXBlb2YgZS5jaGFuZ2VkVG91Y2hlcyAhPT0gJ3VuZGVmaW5lZCcgJiYgZS5jaGFuZ2VkVG91Y2hlcy5sZW5ndGgpIHtcclxuXHRcdFx0Ly8gdG91Y2ggZGV2aWNlc1xyXG5cdFx0XHRjbGllbnRYID0gZS5jaGFuZ2VkVG91Y2hlc1swXS5jbGllbnRYO1xyXG5cdFx0XHRjbGllbnRZID0gZS5jaGFuZ2VkVG91Y2hlc1swXS5jbGllbnRZO1xyXG5cdFx0fSBlbHNlIGlmICh0eXBlb2YgZS5jbGllbnRYID09PSAnbnVtYmVyJykge1xyXG5cdFx0XHRjbGllbnRYID0gZS5jbGllbnRYO1xyXG5cdFx0XHRjbGllbnRZID0gZS5jbGllbnRZO1xyXG5cdFx0fVxyXG5cclxuXHRcdHggPSBjbGllbnRYIC0gdGFyZ2V0UmVjdC5sZWZ0O1xyXG5cdFx0eSA9IGNsaWVudFkgLSB0YXJnZXRSZWN0LnRvcDtcclxuXHRcdHJldHVybiB7IHg6IHgsIHk6IHkgfTtcclxuXHR9LFxyXG5cclxuXHJcblx0Z2V0Vmlld1BvcyA6IGZ1bmN0aW9uICgpIHtcclxuXHRcdHZhciBkb2MgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XHJcblx0XHRyZXR1cm4gW1xyXG5cdFx0XHQod2luZG93LnBhZ2VYT2Zmc2V0IHx8IGRvYy5zY3JvbGxMZWZ0KSAtIChkb2MuY2xpZW50TGVmdCB8fCAwKSxcclxuXHRcdFx0KHdpbmRvdy5wYWdlWU9mZnNldCB8fCBkb2Muc2Nyb2xsVG9wKSAtIChkb2MuY2xpZW50VG9wIHx8IDApXHJcblx0XHRdO1xyXG5cdH0sXHJcblxyXG5cclxuXHRnZXRWaWV3U2l6ZSA6IGZ1bmN0aW9uICgpIHtcclxuXHRcdHZhciBkb2MgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XHJcblx0XHRyZXR1cm4gW1xyXG5cdFx0XHQod2luZG93LmlubmVyV2lkdGggfHwgZG9jLmNsaWVudFdpZHRoKSxcclxuXHRcdFx0KHdpbmRvdy5pbm5lckhlaWdodCB8fCBkb2MuY2xpZW50SGVpZ2h0KSxcclxuXHRcdF07XHJcblx0fSxcclxuXHJcblxyXG5cdHJlZHJhd1Bvc2l0aW9uIDogZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdGlmIChqc2MucGlja2VyICYmIGpzYy5waWNrZXIub3duZXIpIHtcclxuXHRcdFx0dmFyIHRoaXNPYmogPSBqc2MucGlja2VyLm93bmVyO1xyXG5cclxuXHRcdFx0dmFyIHRwLCB2cDtcclxuXHJcblx0XHRcdGlmICh0aGlzT2JqLmZpeGVkKSB7XHJcblx0XHRcdFx0Ly8gRml4ZWQgZWxlbWVudHMgYXJlIHBvc2l0aW9uZWQgcmVsYXRpdmUgdG8gdmlld3BvcnQsXHJcblx0XHRcdFx0Ly8gdGhlcmVmb3JlIHdlIGNhbiBpZ25vcmUgdGhlIHNjcm9sbCBvZmZzZXRcclxuXHRcdFx0XHR0cCA9IGpzYy5nZXRFbGVtZW50UG9zKHRoaXNPYmoudGFyZ2V0RWxlbWVudCwgdHJ1ZSk7IC8vIHRhcmdldCBwb3NcclxuXHRcdFx0XHR2cCA9IFswLCAwXTsgLy8gdmlldyBwb3NcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR0cCA9IGpzYy5nZXRFbGVtZW50UG9zKHRoaXNPYmoudGFyZ2V0RWxlbWVudCk7IC8vIHRhcmdldCBwb3NcclxuXHRcdFx0XHR2cCA9IGpzYy5nZXRWaWV3UG9zKCk7IC8vIHZpZXcgcG9zXHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciB0cyA9IGpzYy5nZXRFbGVtZW50U2l6ZSh0aGlzT2JqLnRhcmdldEVsZW1lbnQpOyAvLyB0YXJnZXQgc2l6ZVxyXG5cdFx0XHR2YXIgdnMgPSBqc2MuZ2V0Vmlld1NpemUoKTsgLy8gdmlldyBzaXplXHJcblx0XHRcdHZhciBwcyA9IGpzYy5nZXRQaWNrZXJPdXRlckRpbXModGhpc09iaik7IC8vIHBpY2tlciBzaXplXHJcblx0XHRcdHZhciBhLCBiLCBjO1xyXG5cdFx0XHRzd2l0Y2ggKHRoaXNPYmoucG9zaXRpb24udG9Mb3dlckNhc2UoKSkge1xyXG5cdFx0XHRcdGNhc2UgJ2xlZnQnOiBhPTE7IGI9MDsgYz0tMTsgYnJlYWs7XHJcblx0XHRcdFx0Y2FzZSAncmlnaHQnOmE9MTsgYj0wOyBjPTE7IGJyZWFrO1xyXG5cdFx0XHRcdGNhc2UgJ3RvcCc6ICBhPTA7IGI9MTsgYz0tMTsgYnJlYWs7XHJcblx0XHRcdFx0ZGVmYXVsdDogICAgIGE9MDsgYj0xOyBjPTE7IGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciBsID0gKHRzW2JdK3BzW2JdKS8yO1xyXG5cclxuXHRcdFx0Ly8gY29tcHV0ZSBwaWNrZXIgcG9zaXRpb25cclxuXHRcdFx0aWYgKCF0aGlzT2JqLnNtYXJ0UG9zaXRpb24pIHtcclxuXHRcdFx0XHR2YXIgcHAgPSBbXHJcblx0XHRcdFx0XHR0cFthXSxcclxuXHRcdFx0XHRcdHRwW2JdK3RzW2JdLWwrbCpjXHJcblx0XHRcdFx0XTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR2YXIgcHAgPSBbXHJcblx0XHRcdFx0XHQtdnBbYV0rdHBbYV0rcHNbYV0gPiB2c1thXSA/XHJcblx0XHRcdFx0XHRcdCgtdnBbYV0rdHBbYV0rdHNbYV0vMiA+IHZzW2FdLzIgJiYgdHBbYV0rdHNbYV0tcHNbYV0gPj0gMCA/IHRwW2FdK3RzW2FdLXBzW2FdIDogdHBbYV0pIDpcclxuXHRcdFx0XHRcdFx0dHBbYV0sXHJcblx0XHRcdFx0XHQtdnBbYl0rdHBbYl0rdHNbYl0rcHNbYl0tbCtsKmMgPiB2c1tiXSA/XHJcblx0XHRcdFx0XHRcdCgtdnBbYl0rdHBbYl0rdHNbYl0vMiA+IHZzW2JdLzIgJiYgdHBbYl0rdHNbYl0tbC1sKmMgPj0gMCA/IHRwW2JdK3RzW2JdLWwtbCpjIDogdHBbYl0rdHNbYl0tbCtsKmMpIDpcclxuXHRcdFx0XHRcdFx0KHRwW2JdK3RzW2JdLWwrbCpjID49IDAgPyB0cFtiXSt0c1tiXS1sK2wqYyA6IHRwW2JdK3RzW2JdLWwtbCpjKVxyXG5cdFx0XHRcdF07XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHZhciB4ID0gcHBbYV07XHJcblx0XHRcdHZhciB5ID0gcHBbYl07XHJcblx0XHRcdHZhciBwb3NpdGlvblZhbHVlID0gdGhpc09iai5maXhlZCA/ICdmaXhlZCcgOiAnYWJzb2x1dGUnO1xyXG5cdFx0XHR2YXIgY29udHJhY3RTaGFkb3cgPVxyXG5cdFx0XHRcdChwcFswXSArIHBzWzBdID4gdHBbMF0gfHwgcHBbMF0gPCB0cFswXSArIHRzWzBdKSAmJlxyXG5cdFx0XHRcdChwcFsxXSArIHBzWzFdIDwgdHBbMV0gKyB0c1sxXSk7XHJcblxyXG5cdFx0XHRqc2MuX2RyYXdQb3NpdGlvbih0aGlzT2JqLCB4LCB5LCBwb3NpdGlvblZhbHVlLCBjb250cmFjdFNoYWRvdyk7XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdF9kcmF3UG9zaXRpb24gOiBmdW5jdGlvbiAodGhpc09iaiwgeCwgeSwgcG9zaXRpb25WYWx1ZSwgY29udHJhY3RTaGFkb3cpIHtcclxuXHRcdHZhciB2U2hhZG93ID0gY29udHJhY3RTaGFkb3cgPyAwIDogdGhpc09iai5zaGFkb3dCbHVyOyAvLyBweFxyXG5cclxuXHRcdGpzYy5waWNrZXIud3JhcC5zdHlsZS5wb3NpdGlvbiA9IHBvc2l0aW9uVmFsdWU7XHJcblx0XHRqc2MucGlja2VyLndyYXAuc3R5bGUubGVmdCA9IHggKyAncHgnO1xyXG5cdFx0anNjLnBpY2tlci53cmFwLnN0eWxlLnRvcCA9IHkgKyAncHgnO1xyXG5cclxuXHRcdGpzYy5zZXRCb3hTaGFkb3coXHJcblx0XHRcdGpzYy5waWNrZXIuYm94UyxcclxuXHRcdFx0dGhpc09iai5zaGFkb3cgP1xyXG5cdFx0XHRcdG5ldyBqc2MuQm94U2hhZG93KDAsIHZTaGFkb3csIHRoaXNPYmouc2hhZG93Qmx1ciwgMCwgdGhpc09iai5zaGFkb3dDb2xvcikgOlxyXG5cdFx0XHRcdG51bGwpO1xyXG5cdH0sXHJcblxyXG5cclxuXHRnZXRQaWNrZXJEaW1zIDogZnVuY3Rpb24gKHRoaXNPYmopIHtcclxuXHRcdHZhciBkaXNwbGF5U2xpZGVyID0gISFqc2MuZ2V0U2xpZGVyQ29tcG9uZW50KHRoaXNPYmopO1xyXG5cdFx0dmFyIGRpbXMgPSBbXHJcblx0XHRcdDIgKiB0aGlzT2JqLmluc2V0V2lkdGggKyAyICogdGhpc09iai5wYWRkaW5nICsgdGhpc09iai53aWR0aCArXHJcblx0XHRcdFx0KGRpc3BsYXlTbGlkZXIgPyAyICogdGhpc09iai5pbnNldFdpZHRoICsganNjLmdldFBhZFRvU2xpZGVyUGFkZGluZyh0aGlzT2JqKSArIHRoaXNPYmouc2xpZGVyU2l6ZSA6IDApLFxyXG5cdFx0XHQyICogdGhpc09iai5pbnNldFdpZHRoICsgMiAqIHRoaXNPYmoucGFkZGluZyArIHRoaXNPYmouaGVpZ2h0ICtcclxuXHRcdFx0XHQodGhpc09iai5jbG9zYWJsZSA/IDIgKiB0aGlzT2JqLmluc2V0V2lkdGggKyB0aGlzT2JqLnBhZGRpbmcgKyB0aGlzT2JqLmJ1dHRvbkhlaWdodCA6IDApXHJcblx0XHRdO1xyXG5cdFx0cmV0dXJuIGRpbXM7XHJcblx0fSxcclxuXHJcblxyXG5cdGdldFBpY2tlck91dGVyRGltcyA6IGZ1bmN0aW9uICh0aGlzT2JqKSB7XHJcblx0XHR2YXIgZGltcyA9IGpzYy5nZXRQaWNrZXJEaW1zKHRoaXNPYmopO1xyXG5cdFx0cmV0dXJuIFtcclxuXHRcdFx0ZGltc1swXSArIDIgKiB0aGlzT2JqLmJvcmRlcldpZHRoLFxyXG5cdFx0XHRkaW1zWzFdICsgMiAqIHRoaXNPYmouYm9yZGVyV2lkdGhcclxuXHRcdF07XHJcblx0fSxcclxuXHJcblxyXG5cdGdldFBhZFRvU2xpZGVyUGFkZGluZyA6IGZ1bmN0aW9uICh0aGlzT2JqKSB7XHJcblx0XHRyZXR1cm4gTWF0aC5tYXgodGhpc09iai5wYWRkaW5nLCAxLjUgKiAoMiAqIHRoaXNPYmoucG9pbnRlckJvcmRlcldpZHRoICsgdGhpc09iai5wb2ludGVyVGhpY2tuZXNzKSk7XHJcblx0fSxcclxuXHJcblxyXG5cdGdldFBhZFlDb21wb25lbnQgOiBmdW5jdGlvbiAodGhpc09iaikge1xyXG5cdFx0c3dpdGNoICh0aGlzT2JqLm1vZGUuY2hhckF0KDEpLnRvTG93ZXJDYXNlKCkpIHtcclxuXHRcdFx0Y2FzZSAndic6IHJldHVybiAndic7IGJyZWFrO1xyXG5cdFx0fVxyXG5cdFx0cmV0dXJuICdzJztcclxuXHR9LFxyXG5cclxuXHJcblx0Z2V0U2xpZGVyQ29tcG9uZW50IDogZnVuY3Rpb24gKHRoaXNPYmopIHtcclxuXHRcdGlmICh0aGlzT2JqLm1vZGUubGVuZ3RoID4gMikge1xyXG5cdFx0XHRzd2l0Y2ggKHRoaXNPYmoubW9kZS5jaGFyQXQoMikudG9Mb3dlckNhc2UoKSkge1xyXG5cdFx0XHRcdGNhc2UgJ3MnOiByZXR1cm4gJ3MnOyBicmVhaztcclxuXHRcdFx0XHRjYXNlICd2JzogcmV0dXJuICd2JzsgYnJlYWs7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH0sXHJcblxyXG5cclxuXHRvbkRvY3VtZW50TW91c2VEb3duIDogZnVuY3Rpb24gKGUpIHtcclxuXHRcdGlmICghZSkgeyBlID0gd2luZG93LmV2ZW50OyB9XHJcblx0XHR2YXIgdGFyZ2V0ID0gZS50YXJnZXQgfHwgZS5zcmNFbGVtZW50O1xyXG5cclxuXHRcdGlmICh0YXJnZXQuX2pzY0xpbmtlZEluc3RhbmNlKSB7XHJcblx0XHRcdGlmICh0YXJnZXQuX2pzY0xpbmtlZEluc3RhbmNlLnNob3dPbkNsaWNrKSB7XHJcblx0XHRcdFx0dGFyZ2V0Ll9qc2NMaW5rZWRJbnN0YW5jZS5zaG93KCk7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSBpZiAodGFyZ2V0Ll9qc2NDb250cm9sTmFtZSkge1xyXG5cdFx0XHRqc2Mub25Db250cm9sUG9pbnRlclN0YXJ0KGUsIHRhcmdldCwgdGFyZ2V0Ll9qc2NDb250cm9sTmFtZSwgJ21vdXNlJyk7XHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHQvLyBNb3VzZSBpcyBvdXRzaWRlIHRoZSBwaWNrZXIgY29udHJvbHMgLT4gaGlkZSB0aGUgY29sb3IgcGlja2VyIVxyXG5cdFx0XHRpZiAoanNjLnBpY2tlciAmJiBqc2MucGlja2VyLm93bmVyKSB7XHJcblx0XHRcdFx0anNjLnBpY2tlci5vd25lci5oaWRlKCk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0b25Eb2N1bWVudFRvdWNoU3RhcnQgOiBmdW5jdGlvbiAoZSkge1xyXG5cdFx0aWYgKCFlKSB7IGUgPSB3aW5kb3cuZXZlbnQ7IH1cclxuXHRcdHZhciB0YXJnZXQgPSBlLnRhcmdldCB8fCBlLnNyY0VsZW1lbnQ7XHJcblxyXG5cdFx0aWYgKHRhcmdldC5fanNjTGlua2VkSW5zdGFuY2UpIHtcclxuXHRcdFx0aWYgKHRhcmdldC5fanNjTGlua2VkSW5zdGFuY2Uuc2hvd09uQ2xpY2spIHtcclxuXHRcdFx0XHR0YXJnZXQuX2pzY0xpbmtlZEluc3RhbmNlLnNob3coKTtcclxuXHRcdFx0fVxyXG5cdFx0fSBlbHNlIGlmICh0YXJnZXQuX2pzY0NvbnRyb2xOYW1lKSB7XHJcblx0XHRcdGpzYy5vbkNvbnRyb2xQb2ludGVyU3RhcnQoZSwgdGFyZ2V0LCB0YXJnZXQuX2pzY0NvbnRyb2xOYW1lLCAndG91Y2gnKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdGlmIChqc2MucGlja2VyICYmIGpzYy5waWNrZXIub3duZXIpIHtcclxuXHRcdFx0XHRqc2MucGlja2VyLm93bmVyLmhpZGUoKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRvbldpbmRvd1Jlc2l6ZSA6IGZ1bmN0aW9uIChlKSB7XHJcblx0XHRqc2MucmVkcmF3UG9zaXRpb24oKTtcclxuXHR9LFxyXG5cclxuXHJcblx0b25QYXJlbnRTY3JvbGwgOiBmdW5jdGlvbiAoZSkge1xyXG5cdFx0Ly8gaGlkZSB0aGUgcGlja2VyIHdoZW4gb25lIG9mIHRoZSBwYXJlbnQgZWxlbWVudHMgaXMgc2Nyb2xsZWRcclxuXHRcdGlmIChqc2MucGlja2VyICYmIGpzYy5waWNrZXIub3duZXIpIHtcclxuXHRcdFx0anNjLnBpY2tlci5vd25lci5oaWRlKCk7XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdF9wb2ludGVyTW92ZUV2ZW50IDoge1xyXG5cdFx0bW91c2U6ICdtb3VzZW1vdmUnLFxyXG5cdFx0dG91Y2g6ICd0b3VjaG1vdmUnXHJcblx0fSxcclxuXHRfcG9pbnRlckVuZEV2ZW50IDoge1xyXG5cdFx0bW91c2U6ICdtb3VzZXVwJyxcclxuXHRcdHRvdWNoOiAndG91Y2hlbmQnXHJcblx0fSxcclxuXHJcblxyXG5cdF9wb2ludGVyT3JpZ2luIDogbnVsbCxcclxuXHRfY2FwdHVyZWRUYXJnZXQgOiBudWxsLFxyXG5cclxuXHJcblx0b25Db250cm9sUG9pbnRlclN0YXJ0IDogZnVuY3Rpb24gKGUsIHRhcmdldCwgY29udHJvbE5hbWUsIHBvaW50ZXJUeXBlKSB7XHJcblx0XHR2YXIgdGhpc09iaiA9IHRhcmdldC5fanNjSW5zdGFuY2U7XHJcblxyXG5cdFx0anNjLnByZXZlbnREZWZhdWx0KGUpO1xyXG5cdFx0anNjLmNhcHR1cmVUYXJnZXQodGFyZ2V0KTtcclxuXHJcblx0XHR2YXIgcmVnaXN0ZXJEcmFnRXZlbnRzID0gZnVuY3Rpb24gKGRvYywgb2Zmc2V0KSB7XHJcblx0XHRcdGpzYy5hdHRhY2hHcm91cEV2ZW50KCdkcmFnJywgZG9jLCBqc2MuX3BvaW50ZXJNb3ZlRXZlbnRbcG9pbnRlclR5cGVdLFxyXG5cdFx0XHRcdGpzYy5vbkRvY3VtZW50UG9pbnRlck1vdmUoZSwgdGFyZ2V0LCBjb250cm9sTmFtZSwgcG9pbnRlclR5cGUsIG9mZnNldCkpO1xyXG5cdFx0XHRqc2MuYXR0YWNoR3JvdXBFdmVudCgnZHJhZycsIGRvYywganNjLl9wb2ludGVyRW5kRXZlbnRbcG9pbnRlclR5cGVdLFxyXG5cdFx0XHRcdGpzYy5vbkRvY3VtZW50UG9pbnRlckVuZChlLCB0YXJnZXQsIGNvbnRyb2xOYW1lLCBwb2ludGVyVHlwZSkpO1xyXG5cdFx0fTtcclxuXHJcblx0XHRyZWdpc3RlckRyYWdFdmVudHMoZG9jdW1lbnQsIFswLCAwXSk7XHJcblxyXG5cdFx0aWYgKHdpbmRvdy5wYXJlbnQgJiYgd2luZG93LmZyYW1lRWxlbWVudCkge1xyXG5cdFx0XHR2YXIgcmVjdCA9IHdpbmRvdy5mcmFtZUVsZW1lbnQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcblx0XHRcdHZhciBvZnMgPSBbLXJlY3QubGVmdCwgLXJlY3QudG9wXTtcclxuXHRcdFx0cmVnaXN0ZXJEcmFnRXZlbnRzKHdpbmRvdy5wYXJlbnQud2luZG93LmRvY3VtZW50LCBvZnMpO1xyXG5cdFx0fVxyXG5cclxuXHRcdHZhciBhYnMgPSBqc2MuZ2V0QWJzUG9pbnRlclBvcyhlKTtcclxuXHRcdHZhciByZWwgPSBqc2MuZ2V0UmVsUG9pbnRlclBvcyhlKTtcclxuXHRcdGpzYy5fcG9pbnRlck9yaWdpbiA9IHtcclxuXHRcdFx0eDogYWJzLnggLSByZWwueCxcclxuXHRcdFx0eTogYWJzLnkgLSByZWwueVxyXG5cdFx0fTtcclxuXHJcblx0XHRzd2l0Y2ggKGNvbnRyb2xOYW1lKSB7XHJcblx0XHRjYXNlICdwYWQnOlxyXG5cdFx0XHQvLyBpZiB0aGUgc2xpZGVyIGlzIGF0IHRoZSBib3R0b20sIG1vdmUgaXQgdXBcclxuXHRcdFx0c3dpdGNoIChqc2MuZ2V0U2xpZGVyQ29tcG9uZW50KHRoaXNPYmopKSB7XHJcblx0XHRcdGNhc2UgJ3MnOiBpZiAodGhpc09iai5oc3ZbMV0gPT09IDApIHsgdGhpc09iai5mcm9tSFNWKG51bGwsIDEwMCwgbnVsbCk7IH07IGJyZWFrO1xyXG5cdFx0XHRjYXNlICd2JzogaWYgKHRoaXNPYmouaHN2WzJdID09PSAwKSB7IHRoaXNPYmouZnJvbUhTVihudWxsLCBudWxsLCAxMDApOyB9OyBicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0XHRqc2Muc2V0UGFkKHRoaXNPYmosIGUsIDAsIDApO1xyXG5cdFx0XHRicmVhaztcclxuXHJcblx0XHRjYXNlICdzbGQnOlxyXG5cdFx0XHRqc2Muc2V0U2xkKHRoaXNPYmosIGUsIDApO1xyXG5cdFx0XHRicmVhaztcclxuXHRcdH1cclxuXHJcblx0XHRqc2MuZGlzcGF0Y2hGaW5lQ2hhbmdlKHRoaXNPYmopO1xyXG5cdH0sXHJcblxyXG5cclxuXHRvbkRvY3VtZW50UG9pbnRlck1vdmUgOiBmdW5jdGlvbiAoZSwgdGFyZ2V0LCBjb250cm9sTmFtZSwgcG9pbnRlclR5cGUsIG9mZnNldCkge1xyXG5cdFx0cmV0dXJuIGZ1bmN0aW9uIChlKSB7XHJcblx0XHRcdHZhciB0aGlzT2JqID0gdGFyZ2V0Ll9qc2NJbnN0YW5jZTtcclxuXHRcdFx0c3dpdGNoIChjb250cm9sTmFtZSkge1xyXG5cdFx0XHRjYXNlICdwYWQnOlxyXG5cdFx0XHRcdGlmICghZSkgeyBlID0gd2luZG93LmV2ZW50OyB9XHJcblx0XHRcdFx0anNjLnNldFBhZCh0aGlzT2JqLCBlLCBvZmZzZXRbMF0sIG9mZnNldFsxXSk7XHJcblx0XHRcdFx0anNjLmRpc3BhdGNoRmluZUNoYW5nZSh0aGlzT2JqKTtcclxuXHRcdFx0XHRicmVhaztcclxuXHJcblx0XHRcdGNhc2UgJ3NsZCc6XHJcblx0XHRcdFx0aWYgKCFlKSB7IGUgPSB3aW5kb3cuZXZlbnQ7IH1cclxuXHRcdFx0XHRqc2Muc2V0U2xkKHRoaXNPYmosIGUsIG9mZnNldFsxXSk7XHJcblx0XHRcdFx0anNjLmRpc3BhdGNoRmluZUNoYW5nZSh0aGlzT2JqKTtcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH0sXHJcblxyXG5cclxuXHRvbkRvY3VtZW50UG9pbnRlckVuZCA6IGZ1bmN0aW9uIChlLCB0YXJnZXQsIGNvbnRyb2xOYW1lLCBwb2ludGVyVHlwZSkge1xyXG5cdFx0cmV0dXJuIGZ1bmN0aW9uIChlKSB7XHJcblx0XHRcdHZhciB0aGlzT2JqID0gdGFyZ2V0Ll9qc2NJbnN0YW5jZTtcclxuXHRcdFx0anNjLmRldGFjaEdyb3VwRXZlbnRzKCdkcmFnJyk7XHJcblx0XHRcdGpzYy5yZWxlYXNlVGFyZ2V0KCk7XHJcblx0XHRcdC8vIEFsd2F5cyBkaXNwYXRjaCBjaGFuZ2VzIGFmdGVyIGRldGFjaGluZyBvdXRzdGFuZGluZyBtb3VzZSBoYW5kbGVycyxcclxuXHRcdFx0Ly8gaW4gY2FzZSBzb21lIHVzZXIgaW50ZXJhY3Rpb24gd2lsbCBvY2N1ciBpbiB1c2VyJ3Mgb25jaGFuZ2UgY2FsbGJhY2tcclxuXHRcdFx0Ly8gdGhhdCB3b3VsZCBpbnRydWRlIHdpdGggY3VycmVudCBtb3VzZSBldmVudHNcclxuXHRcdFx0anNjLmRpc3BhdGNoQ2hhbmdlKHRoaXNPYmopO1xyXG5cdFx0fTtcclxuXHR9LFxyXG5cclxuXHJcblx0ZGlzcGF0Y2hDaGFuZ2UgOiBmdW5jdGlvbiAodGhpc09iaikge1xyXG5cdFx0aWYgKHRoaXNPYmoudmFsdWVFbGVtZW50KSB7XHJcblx0XHRcdGlmIChqc2MuaXNFbGVtZW50VHlwZSh0aGlzT2JqLnZhbHVlRWxlbWVudCwgJ2lucHV0JykpIHtcclxuXHRcdFx0XHRqc2MuZmlyZUV2ZW50KHRoaXNPYmoudmFsdWVFbGVtZW50LCAnY2hhbmdlJyk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0ZGlzcGF0Y2hGaW5lQ2hhbmdlIDogZnVuY3Rpb24gKHRoaXNPYmopIHtcclxuXHRcdGlmICh0aGlzT2JqLm9uRmluZUNoYW5nZSkge1xyXG5cdFx0XHR2YXIgY2FsbGJhY2s7XHJcblx0XHRcdGlmICh0eXBlb2YgdGhpc09iai5vbkZpbmVDaGFuZ2UgPT09ICdzdHJpbmcnKSB7XHJcblx0XHRcdFx0Y2FsbGJhY2sgPSBuZXcgRnVuY3Rpb24odGhpc09iai5vbkZpbmVDaGFuZ2UpO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGNhbGxiYWNrID0gdGhpc09iai5vbkZpbmVDaGFuZ2U7XHJcblx0XHRcdH1cclxuXHRcdFx0Y2FsbGJhY2suY2FsbCh0aGlzT2JqKTtcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0c2V0UGFkIDogZnVuY3Rpb24gKHRoaXNPYmosIGUsIG9mc1gsIG9mc1kpIHtcclxuXHRcdHZhciBwb2ludGVyQWJzID0ganNjLmdldEFic1BvaW50ZXJQb3MoZSk7XHJcblx0XHR2YXIgeCA9IG9mc1ggKyBwb2ludGVyQWJzLnggLSBqc2MuX3BvaW50ZXJPcmlnaW4ueCAtIHRoaXNPYmoucGFkZGluZyAtIHRoaXNPYmouaW5zZXRXaWR0aDtcclxuXHRcdHZhciB5ID0gb2ZzWSArIHBvaW50ZXJBYnMueSAtIGpzYy5fcG9pbnRlck9yaWdpbi55IC0gdGhpc09iai5wYWRkaW5nIC0gdGhpc09iai5pbnNldFdpZHRoO1xyXG5cclxuXHRcdHZhciB4VmFsID0geCAqICgzNjAgLyAodGhpc09iai53aWR0aCAtIDEpKTtcclxuXHRcdHZhciB5VmFsID0gMTAwIC0gKHkgKiAoMTAwIC8gKHRoaXNPYmouaGVpZ2h0IC0gMSkpKTtcclxuXHJcblx0XHRzd2l0Y2ggKGpzYy5nZXRQYWRZQ29tcG9uZW50KHRoaXNPYmopKSB7XHJcblx0XHRjYXNlICdzJzogdGhpc09iai5mcm9tSFNWKHhWYWwsIHlWYWwsIG51bGwsIGpzYy5sZWF2ZVNsZCk7IGJyZWFrO1xyXG5cdFx0Y2FzZSAndic6IHRoaXNPYmouZnJvbUhTVih4VmFsLCBudWxsLCB5VmFsLCBqc2MubGVhdmVTbGQpOyBicmVhaztcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0c2V0U2xkIDogZnVuY3Rpb24gKHRoaXNPYmosIGUsIG9mc1kpIHtcclxuXHRcdHZhciBwb2ludGVyQWJzID0ganNjLmdldEFic1BvaW50ZXJQb3MoZSk7XHJcblx0XHR2YXIgeSA9IG9mc1kgKyBwb2ludGVyQWJzLnkgLSBqc2MuX3BvaW50ZXJPcmlnaW4ueSAtIHRoaXNPYmoucGFkZGluZyAtIHRoaXNPYmouaW5zZXRXaWR0aDtcclxuXHJcblx0XHR2YXIgeVZhbCA9IDEwMCAtICh5ICogKDEwMCAvICh0aGlzT2JqLmhlaWdodCAtIDEpKSk7XHJcblxyXG5cdFx0c3dpdGNoIChqc2MuZ2V0U2xpZGVyQ29tcG9uZW50KHRoaXNPYmopKSB7XHJcblx0XHRjYXNlICdzJzogdGhpc09iai5mcm9tSFNWKG51bGwsIHlWYWwsIG51bGwsIGpzYy5sZWF2ZVBhZCk7IGJyZWFrO1xyXG5cdFx0Y2FzZSAndic6IHRoaXNPYmouZnJvbUhTVihudWxsLCBudWxsLCB5VmFsLCBqc2MubGVhdmVQYWQpOyBicmVhaztcclxuXHRcdH1cclxuXHR9LFxyXG5cclxuXHJcblx0X3ZtbE5TIDogJ2pzY192bWxfJyxcclxuXHRfdm1sQ1NTIDogJ2pzY192bWxfY3NzXycsXHJcblx0X3ZtbFJlYWR5IDogZmFsc2UsXHJcblxyXG5cclxuXHRpbml0Vk1MIDogZnVuY3Rpb24gKCkge1xyXG5cdFx0aWYgKCFqc2MuX3ZtbFJlYWR5KSB7XHJcblx0XHRcdC8vIGluaXQgVk1MIG5hbWVzcGFjZVxyXG5cdFx0XHR2YXIgZG9jID0gZG9jdW1lbnQ7XHJcblx0XHRcdGlmICghZG9jLm5hbWVzcGFjZXNbanNjLl92bWxOU10pIHtcclxuXHRcdFx0XHRkb2MubmFtZXNwYWNlcy5hZGQoanNjLl92bWxOUywgJ3VybjpzY2hlbWFzLW1pY3Jvc29mdC1jb206dm1sJyk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKCFkb2Muc3R5bGVTaGVldHNbanNjLl92bWxDU1NdKSB7XHJcblx0XHRcdFx0dmFyIHRhZ3MgPSBbJ3NoYXBlJywgJ3NoYXBldHlwZScsICdncm91cCcsICdiYWNrZ3JvdW5kJywgJ3BhdGgnLCAnZm9ybXVsYXMnLCAnaGFuZGxlcycsICdmaWxsJywgJ3N0cm9rZScsICdzaGFkb3cnLCAndGV4dGJveCcsICd0ZXh0cGF0aCcsICdpbWFnZWRhdGEnLCAnbGluZScsICdwb2x5bGluZScsICdjdXJ2ZScsICdyZWN0JywgJ3JvdW5kcmVjdCcsICdvdmFsJywgJ2FyYycsICdpbWFnZSddO1xyXG5cdFx0XHRcdHZhciBzcyA9IGRvYy5jcmVhdGVTdHlsZVNoZWV0KCk7XHJcblx0XHRcdFx0c3Mub3duaW5nRWxlbWVudC5pZCA9IGpzYy5fdm1sQ1NTO1xyXG5cdFx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgdGFncy5sZW5ndGg7IGkgKz0gMSkge1xyXG5cdFx0XHRcdFx0c3MuYWRkUnVsZShqc2MuX3ZtbE5TICsgJ1xcXFw6JyArIHRhZ3NbaV0sICdiZWhhdmlvcjp1cmwoI2RlZmF1bHQjVk1MKTsnKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0anNjLl92bWxSZWFkeSA9IHRydWU7XHJcblx0XHR9XHJcblx0fSxcclxuXHJcblxyXG5cdGNyZWF0ZVBhbGV0dGUgOiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0dmFyIHBhbGV0dGVPYmogPSB7XHJcblx0XHRcdGVsbTogbnVsbCxcclxuXHRcdFx0ZHJhdzogbnVsbFxyXG5cdFx0fTtcclxuXHJcblx0XHRpZiAoanNjLmlzQ2FudmFzU3VwcG9ydGVkKSB7XHJcblx0XHRcdC8vIENhbnZhcyBpbXBsZW1lbnRhdGlvbiBmb3IgbW9kZXJuIGJyb3dzZXJzXHJcblxyXG5cdFx0XHR2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XHJcblx0XHRcdHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcclxuXHJcblx0XHRcdHZhciBkcmF3RnVuYyA9IGZ1bmN0aW9uICh3aWR0aCwgaGVpZ2h0LCB0eXBlKSB7XHJcblx0XHRcdFx0Y2FudmFzLndpZHRoID0gd2lkdGg7XHJcblx0XHRcdFx0Y2FudmFzLmhlaWdodCA9IGhlaWdodDtcclxuXHJcblx0XHRcdFx0Y3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpO1xyXG5cclxuXHRcdFx0XHR2YXIgaEdyYWQgPSBjdHguY3JlYXRlTGluZWFyR3JhZGllbnQoMCwgMCwgY2FudmFzLndpZHRoLCAwKTtcclxuXHRcdFx0XHRoR3JhZC5hZGRDb2xvclN0b3AoMCAvIDYsICcjRjAwJyk7XHJcblx0XHRcdFx0aEdyYWQuYWRkQ29sb3JTdG9wKDEgLyA2LCAnI0ZGMCcpO1xyXG5cdFx0XHRcdGhHcmFkLmFkZENvbG9yU3RvcCgyIC8gNiwgJyMwRjAnKTtcclxuXHRcdFx0XHRoR3JhZC5hZGRDb2xvclN0b3AoMyAvIDYsICcjMEZGJyk7XHJcblx0XHRcdFx0aEdyYWQuYWRkQ29sb3JTdG9wKDQgLyA2LCAnIzAwRicpO1xyXG5cdFx0XHRcdGhHcmFkLmFkZENvbG9yU3RvcCg1IC8gNiwgJyNGMEYnKTtcclxuXHRcdFx0XHRoR3JhZC5hZGRDb2xvclN0b3AoNiAvIDYsICcjRjAwJyk7XHJcblxyXG5cdFx0XHRcdGN0eC5maWxsU3R5bGUgPSBoR3JhZDtcclxuXHRcdFx0XHRjdHguZmlsbFJlY3QoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0KTtcclxuXHJcblx0XHRcdFx0dmFyIHZHcmFkID0gY3R4LmNyZWF0ZUxpbmVhckdyYWRpZW50KDAsIDAsIDAsIGNhbnZhcy5oZWlnaHQpO1xyXG5cdFx0XHRcdHN3aXRjaCAodHlwZS50b0xvd2VyQ2FzZSgpKSB7XHJcblx0XHRcdFx0Y2FzZSAncyc6XHJcblx0XHRcdFx0XHR2R3JhZC5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMjU1LDI1NSwyNTUsMCknKTtcclxuXHRcdFx0XHRcdHZHcmFkLmFkZENvbG9yU3RvcCgxLCAncmdiYSgyNTUsMjU1LDI1NSwxKScpO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0Y2FzZSAndic6XHJcblx0XHRcdFx0XHR2R3JhZC5hZGRDb2xvclN0b3AoMCwgJ3JnYmEoMCwwLDAsMCknKTtcclxuXHRcdFx0XHRcdHZHcmFkLmFkZENvbG9yU3RvcCgxLCAncmdiYSgwLDAsMCwxKScpO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGN0eC5maWxsU3R5bGUgPSB2R3JhZDtcclxuXHRcdFx0XHRjdHguZmlsbFJlY3QoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0KTtcclxuXHRcdFx0fTtcclxuXHJcblx0XHRcdHBhbGV0dGVPYmouZWxtID0gY2FudmFzO1xyXG5cdFx0XHRwYWxldHRlT2JqLmRyYXcgPSBkcmF3RnVuYztcclxuXHJcblx0XHR9IGVsc2Uge1xyXG5cdFx0XHQvLyBWTUwgZmFsbGJhY2sgZm9yIElFIDcgYW5kIDhcclxuXHJcblx0XHRcdGpzYy5pbml0Vk1MKCk7XHJcblxyXG5cdFx0XHR2YXIgdm1sQ29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcblx0XHRcdHZtbENvbnRhaW5lci5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XHJcblx0XHRcdHZtbENvbnRhaW5lci5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xyXG5cclxuXHRcdFx0dmFyIGhHcmFkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChqc2MuX3ZtbE5TICsgJzpmaWxsJyk7XHJcblx0XHRcdGhHcmFkLnR5cGUgPSAnZ3JhZGllbnQnO1xyXG5cdFx0XHRoR3JhZC5tZXRob2QgPSAnbGluZWFyJztcclxuXHRcdFx0aEdyYWQuYW5nbGUgPSAnOTAnO1xyXG5cdFx0XHRoR3JhZC5jb2xvcnMgPSAnMTYuNjclICNGMEYsIDMzLjMzJSAjMDBGLCA1MCUgIzBGRiwgNjYuNjclICMwRjAsIDgzLjMzJSAjRkYwJ1xyXG5cclxuXHRcdFx0dmFyIGhSZWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChqc2MuX3ZtbE5TICsgJzpyZWN0Jyk7XHJcblx0XHRcdGhSZWN0LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcclxuXHRcdFx0aFJlY3Quc3R5bGUubGVmdCA9IC0xICsgJ3B4JztcclxuXHRcdFx0aFJlY3Quc3R5bGUudG9wID0gLTEgKyAncHgnO1xyXG5cdFx0XHRoUmVjdC5zdHJva2VkID0gZmFsc2U7XHJcblx0XHRcdGhSZWN0LmFwcGVuZENoaWxkKGhHcmFkKTtcclxuXHRcdFx0dm1sQ29udGFpbmVyLmFwcGVuZENoaWxkKGhSZWN0KTtcclxuXHJcblx0XHRcdHZhciB2R3JhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoanNjLl92bWxOUyArICc6ZmlsbCcpO1xyXG5cdFx0XHR2R3JhZC50eXBlID0gJ2dyYWRpZW50JztcclxuXHRcdFx0dkdyYWQubWV0aG9kID0gJ2xpbmVhcic7XHJcblx0XHRcdHZHcmFkLmFuZ2xlID0gJzE4MCc7XHJcblx0XHRcdHZHcmFkLm9wYWNpdHkgPSAnMCc7XHJcblxyXG5cdFx0XHR2YXIgdlJlY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KGpzYy5fdm1sTlMgKyAnOnJlY3QnKTtcclxuXHRcdFx0dlJlY3Quc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xyXG5cdFx0XHR2UmVjdC5zdHlsZS5sZWZ0ID0gLTEgKyAncHgnO1xyXG5cdFx0XHR2UmVjdC5zdHlsZS50b3AgPSAtMSArICdweCc7XHJcblx0XHRcdHZSZWN0LnN0cm9rZWQgPSBmYWxzZTtcclxuXHRcdFx0dlJlY3QuYXBwZW5kQ2hpbGQodkdyYWQpO1xyXG5cdFx0XHR2bWxDb250YWluZXIuYXBwZW5kQ2hpbGQodlJlY3QpO1xyXG5cclxuXHRcdFx0dmFyIGRyYXdGdW5jID0gZnVuY3Rpb24gKHdpZHRoLCBoZWlnaHQsIHR5cGUpIHtcclxuXHRcdFx0XHR2bWxDb250YWluZXIuc3R5bGUud2lkdGggPSB3aWR0aCArICdweCc7XHJcblx0XHRcdFx0dm1sQ29udGFpbmVyLnN0eWxlLmhlaWdodCA9IGhlaWdodCArICdweCc7XHJcblxyXG5cdFx0XHRcdGhSZWN0LnN0eWxlLndpZHRoID1cclxuXHRcdFx0XHR2UmVjdC5zdHlsZS53aWR0aCA9XHJcblx0XHRcdFx0XHQod2lkdGggKyAxKSArICdweCc7XHJcblx0XHRcdFx0aFJlY3Quc3R5bGUuaGVpZ2h0ID1cclxuXHRcdFx0XHR2UmVjdC5zdHlsZS5oZWlnaHQgPVxyXG5cdFx0XHRcdFx0KGhlaWdodCArIDEpICsgJ3B4JztcclxuXHJcblx0XHRcdFx0Ly8gQ29sb3JzIG11c3QgYmUgc3BlY2lmaWVkIGR1cmluZyBldmVyeSByZWRyYXcsIG90aGVyd2lzZSBJRSB3b24ndCBkaXNwbGF5XHJcblx0XHRcdFx0Ly8gYSBmdWxsIGdyYWRpZW50IGR1cmluZyBhIHN1YnNlcXVlbnRpYWwgcmVkcmF3XHJcblx0XHRcdFx0aEdyYWQuY29sb3IgPSAnI0YwMCc7XHJcblx0XHRcdFx0aEdyYWQuY29sb3IyID0gJyNGMDAnO1xyXG5cclxuXHRcdFx0XHRzd2l0Y2ggKHR5cGUudG9Mb3dlckNhc2UoKSkge1xyXG5cdFx0XHRcdGNhc2UgJ3MnOlxyXG5cdFx0XHRcdFx0dkdyYWQuY29sb3IgPSB2R3JhZC5jb2xvcjIgPSAnI0ZGRic7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRjYXNlICd2JzpcclxuXHRcdFx0XHRcdHZHcmFkLmNvbG9yID0gdkdyYWQuY29sb3IyID0gJyMwMDAnO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9O1xyXG5cdFx0XHRcclxuXHRcdFx0cGFsZXR0ZU9iai5lbG0gPSB2bWxDb250YWluZXI7XHJcblx0XHRcdHBhbGV0dGVPYmouZHJhdyA9IGRyYXdGdW5jO1xyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBwYWxldHRlT2JqO1xyXG5cdH0sXHJcblxyXG5cclxuXHRjcmVhdGVTbGlkZXJHcmFkaWVudCA6IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHR2YXIgc2xpZGVyT2JqID0ge1xyXG5cdFx0XHRlbG06IG51bGwsXHJcblx0XHRcdGRyYXc6IG51bGxcclxuXHRcdH07XHJcblxyXG5cdFx0aWYgKGpzYy5pc0NhbnZhc1N1cHBvcnRlZCkge1xyXG5cdFx0XHQvLyBDYW52YXMgaW1wbGVtZW50YXRpb24gZm9yIG1vZGVybiBicm93c2Vyc1xyXG5cclxuXHRcdFx0dmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG5cdFx0XHR2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XHJcblxyXG5cdFx0XHR2YXIgZHJhd0Z1bmMgPSBmdW5jdGlvbiAod2lkdGgsIGhlaWdodCwgY29sb3IxLCBjb2xvcjIpIHtcclxuXHRcdFx0XHRjYW52YXMud2lkdGggPSB3aWR0aDtcclxuXHRcdFx0XHRjYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xyXG5cclxuXHRcdFx0XHRjdHguY2xlYXJSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XHJcblxyXG5cdFx0XHRcdHZhciBncmFkID0gY3R4LmNyZWF0ZUxpbmVhckdyYWRpZW50KDAsIDAsIDAsIGNhbnZhcy5oZWlnaHQpO1xyXG5cdFx0XHRcdGdyYWQuYWRkQ29sb3JTdG9wKDAsIGNvbG9yMSk7XHJcblx0XHRcdFx0Z3JhZC5hZGRDb2xvclN0b3AoMSwgY29sb3IyKTtcclxuXHJcblx0XHRcdFx0Y3R4LmZpbGxTdHlsZSA9IGdyYWQ7XHJcblx0XHRcdFx0Y3R4LmZpbGxSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XHJcblx0XHRcdH07XHJcblxyXG5cdFx0XHRzbGlkZXJPYmouZWxtID0gY2FudmFzO1xyXG5cdFx0XHRzbGlkZXJPYmouZHJhdyA9IGRyYXdGdW5jO1xyXG5cclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdC8vIFZNTCBmYWxsYmFjayBmb3IgSUUgNyBhbmQgOFxyXG5cclxuXHRcdFx0anNjLmluaXRWTUwoKTtcclxuXHJcblx0XHRcdHZhciB2bWxDb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuXHRcdFx0dm1sQ29udGFpbmVyLnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcclxuXHRcdFx0dm1sQ29udGFpbmVyLnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XHJcblxyXG5cdFx0XHR2YXIgZ3JhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoanNjLl92bWxOUyArICc6ZmlsbCcpO1xyXG5cdFx0XHRncmFkLnR5cGUgPSAnZ3JhZGllbnQnO1xyXG5cdFx0XHRncmFkLm1ldGhvZCA9ICdsaW5lYXInO1xyXG5cdFx0XHRncmFkLmFuZ2xlID0gJzE4MCc7XHJcblxyXG5cdFx0XHR2YXIgcmVjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoanNjLl92bWxOUyArICc6cmVjdCcpO1xyXG5cdFx0XHRyZWN0LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcclxuXHRcdFx0cmVjdC5zdHlsZS5sZWZ0ID0gLTEgKyAncHgnO1xyXG5cdFx0XHRyZWN0LnN0eWxlLnRvcCA9IC0xICsgJ3B4JztcclxuXHRcdFx0cmVjdC5zdHJva2VkID0gZmFsc2U7XHJcblx0XHRcdHJlY3QuYXBwZW5kQ2hpbGQoZ3JhZCk7XHJcblx0XHRcdHZtbENvbnRhaW5lci5hcHBlbmRDaGlsZChyZWN0KTtcclxuXHJcblx0XHRcdHZhciBkcmF3RnVuYyA9IGZ1bmN0aW9uICh3aWR0aCwgaGVpZ2h0LCBjb2xvcjEsIGNvbG9yMikge1xyXG5cdFx0XHRcdHZtbENvbnRhaW5lci5zdHlsZS53aWR0aCA9IHdpZHRoICsgJ3B4JztcclxuXHRcdFx0XHR2bWxDb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gaGVpZ2h0ICsgJ3B4JztcclxuXHJcblx0XHRcdFx0cmVjdC5zdHlsZS53aWR0aCA9ICh3aWR0aCArIDEpICsgJ3B4JztcclxuXHRcdFx0XHRyZWN0LnN0eWxlLmhlaWdodCA9IChoZWlnaHQgKyAxKSArICdweCc7XHJcblxyXG5cdFx0XHRcdGdyYWQuY29sb3IgPSBjb2xvcjE7XHJcblx0XHRcdFx0Z3JhZC5jb2xvcjIgPSBjb2xvcjI7XHJcblx0XHRcdH07XHJcblx0XHRcdFxyXG5cdFx0XHRzbGlkZXJPYmouZWxtID0gdm1sQ29udGFpbmVyO1xyXG5cdFx0XHRzbGlkZXJPYmouZHJhdyA9IGRyYXdGdW5jO1xyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBzbGlkZXJPYmo7XHJcblx0fSxcclxuXHJcblxyXG5cdGxlYXZlVmFsdWUgOiAxPDwwLFxyXG5cdGxlYXZlU3R5bGUgOiAxPDwxLFxyXG5cdGxlYXZlUGFkIDogMTw8MixcclxuXHRsZWF2ZVNsZCA6IDE8PDMsXHJcblxyXG5cclxuXHRCb3hTaGFkb3cgOiAoZnVuY3Rpb24gKCkge1xyXG5cdFx0dmFyIEJveFNoYWRvdyA9IGZ1bmN0aW9uIChoU2hhZG93LCB2U2hhZG93LCBibHVyLCBzcHJlYWQsIGNvbG9yLCBpbnNldCkge1xyXG5cdFx0XHR0aGlzLmhTaGFkb3cgPSBoU2hhZG93O1xyXG5cdFx0XHR0aGlzLnZTaGFkb3cgPSB2U2hhZG93O1xyXG5cdFx0XHR0aGlzLmJsdXIgPSBibHVyO1xyXG5cdFx0XHR0aGlzLnNwcmVhZCA9IHNwcmVhZDtcclxuXHRcdFx0dGhpcy5jb2xvciA9IGNvbG9yO1xyXG5cdFx0XHR0aGlzLmluc2V0ID0gISFpbnNldDtcclxuXHRcdH07XHJcblxyXG5cdFx0Qm94U2hhZG93LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dmFyIHZhbHMgPSBbXHJcblx0XHRcdFx0TWF0aC5yb3VuZCh0aGlzLmhTaGFkb3cpICsgJ3B4JyxcclxuXHRcdFx0XHRNYXRoLnJvdW5kKHRoaXMudlNoYWRvdykgKyAncHgnLFxyXG5cdFx0XHRcdE1hdGgucm91bmQodGhpcy5ibHVyKSArICdweCcsXHJcblx0XHRcdFx0TWF0aC5yb3VuZCh0aGlzLnNwcmVhZCkgKyAncHgnLFxyXG5cdFx0XHRcdHRoaXMuY29sb3JcclxuXHRcdFx0XTtcclxuXHRcdFx0aWYgKHRoaXMuaW5zZXQpIHtcclxuXHRcdFx0XHR2YWxzLnB1c2goJ2luc2V0Jyk7XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIHZhbHMuam9pbignICcpO1xyXG5cdFx0fTtcclxuXHJcblx0XHRyZXR1cm4gQm94U2hhZG93O1xyXG5cdH0pKCksXHJcblxyXG5cclxuXHQvL1xyXG5cdC8vIFVzYWdlOlxyXG5cdC8vIHZhciBteUNvbG9yID0gbmV3IGpzY29sb3IoPHRhcmdldEVsZW1lbnQ+IFssIDxvcHRpb25zPl0pXHJcblx0Ly9cclxuXHJcblx0anNjb2xvciA6IGZ1bmN0aW9uICh0YXJnZXRFbGVtZW50LCBvcHRpb25zKSB7XHJcblxyXG5cdFx0Ly8gR2VuZXJhbCBvcHRpb25zXHJcblx0XHQvL1xyXG5cdFx0dGhpcy52YWx1ZSA9IG51bGw7IC8vIGluaXRpYWwgSEVYIGNvbG9yLiBUbyBjaGFuZ2UgaXQgbGF0ZXIsIHVzZSBtZXRob2RzIGZyb21TdHJpbmcoKSwgZnJvbUhTVigpIGFuZCBmcm9tUkdCKClcclxuXHRcdHRoaXMudmFsdWVFbGVtZW50ID0gdGFyZ2V0RWxlbWVudDsgLy8gZWxlbWVudCB0aGF0IHdpbGwgYmUgdXNlZCB0byBkaXNwbGF5IGFuZCBpbnB1dCB0aGUgY29sb3IgY29kZVxyXG5cdFx0dGhpcy5zdHlsZUVsZW1lbnQgPSB0YXJnZXRFbGVtZW50OyAvLyBlbGVtZW50IHRoYXQgd2lsbCBwcmV2aWV3IHRoZSBwaWNrZWQgY29sb3IgdXNpbmcgQ1NTIGJhY2tncm91bmRDb2xvclxyXG5cdFx0dGhpcy5yZXF1aXJlZCA9IHRydWU7IC8vIHdoZXRoZXIgdGhlIGFzc29jaWF0ZWQgdGV4dCA8aW5wdXQ+IGNhbiBiZSBsZWZ0IGVtcHR5XHJcblx0XHR0aGlzLnJlZmluZSA9IHRydWU7IC8vIHdoZXRoZXIgdG8gcmVmaW5lIHRoZSBlbnRlcmVkIGNvbG9yIGNvZGUgKGUuZy4gdXBwZXJjYXNlIGl0IGFuZCByZW1vdmUgd2hpdGVzcGFjZSlcclxuXHRcdHRoaXMuaGFzaCA9IGZhbHNlOyAvLyB3aGV0aGVyIHRvIHByZWZpeCB0aGUgSEVYIGNvbG9yIGNvZGUgd2l0aCAjIHN5bWJvbFxyXG5cdFx0dGhpcy51cHBlcmNhc2UgPSB0cnVlOyAvLyB3aGV0aGVyIHRvIHVwcGVyY2FzZSB0aGUgY29sb3IgY29kZVxyXG5cdFx0dGhpcy5vbkZpbmVDaGFuZ2UgPSBudWxsOyAvLyBjYWxsZWQgaW5zdGFudGx5IGV2ZXJ5IHRpbWUgdGhlIGNvbG9yIGNoYW5nZXMgKHZhbHVlIGNhbiBiZSBlaXRoZXIgYSBmdW5jdGlvbiBvciBhIHN0cmluZyB3aXRoIGphdmFzY3JpcHQgY29kZSlcclxuXHRcdHRoaXMuYWN0aXZlQ2xhc3MgPSAnanNjb2xvci1hY3RpdmUnOyAvLyBjbGFzcyB0byBiZSBzZXQgdG8gdGhlIHRhcmdldCBlbGVtZW50IHdoZW4gYSBwaWNrZXIgd2luZG93IGlzIG9wZW4gb24gaXRcclxuXHRcdHRoaXMubWluUyA9IDA7IC8vIG1pbiBhbGxvd2VkIHNhdHVyYXRpb24gKDAgLSAxMDApXHJcblx0XHR0aGlzLm1heFMgPSAxMDA7IC8vIG1heCBhbGxvd2VkIHNhdHVyYXRpb24gKDAgLSAxMDApXHJcblx0XHR0aGlzLm1pblYgPSAwOyAvLyBtaW4gYWxsb3dlZCB2YWx1ZSAoYnJpZ2h0bmVzcykgKDAgLSAxMDApXHJcblx0XHR0aGlzLm1heFYgPSAxMDA7IC8vIG1heCBhbGxvd2VkIHZhbHVlIChicmlnaHRuZXNzKSAoMCAtIDEwMClcclxuXHJcblx0XHQvLyBBY2Nlc3NpbmcgdGhlIHBpY2tlZCBjb2xvclxyXG5cdFx0Ly9cclxuXHRcdHRoaXMuaHN2ID0gWzAsIDAsIDEwMF07IC8vIHJlYWQtb25seSAgWzAtMzYwLCAwLTEwMCwgMC0xMDBdXHJcblx0XHR0aGlzLnJnYiA9IFsyNTUsIDI1NSwgMjU1XTsgLy8gcmVhZC1vbmx5ICBbMC0yNTUsIDAtMjU1LCAwLTI1NV1cclxuXHJcblx0XHQvLyBDb2xvciBQaWNrZXIgb3B0aW9uc1xyXG5cdFx0Ly9cclxuXHRcdHRoaXMud2lkdGggPSAxODE7IC8vIHdpZHRoIG9mIGNvbG9yIHBhbGV0dGUgKGluIHB4KVxyXG5cdFx0dGhpcy5oZWlnaHQgPSAxMDE7IC8vIGhlaWdodCBvZiBjb2xvciBwYWxldHRlIChpbiBweClcclxuXHRcdHRoaXMuc2hvd09uQ2xpY2sgPSB0cnVlOyAvLyB3aGV0aGVyIHRvIGRpc3BsYXkgdGhlIGNvbG9yIHBpY2tlciB3aGVuIHVzZXIgY2xpY2tzIG9uIGl0cyB0YXJnZXQgZWxlbWVudFxyXG5cdFx0dGhpcy5tb2RlID0gJ0hTVic7IC8vIEhTViB8IEhWUyB8IEhTIHwgSFYgLSBsYXlvdXQgb2YgdGhlIGNvbG9yIHBpY2tlciBjb250cm9sc1xyXG5cdFx0dGhpcy5wb3NpdGlvbiA9ICdib3R0b20nOyAvLyBsZWZ0IHwgcmlnaHQgfCB0b3AgfCBib3R0b20gLSBwb3NpdGlvbiByZWxhdGl2ZSB0byB0aGUgdGFyZ2V0IGVsZW1lbnRcclxuXHRcdHRoaXMuc21hcnRQb3NpdGlvbiA9IHRydWU7IC8vIGF1dG9tYXRpY2FsbHkgY2hhbmdlIHBpY2tlciBwb3NpdGlvbiB3aGVuIHRoZXJlIGlzIG5vdCBlbm91Z2ggc3BhY2UgZm9yIGl0XHJcblx0XHR0aGlzLnNsaWRlclNpemUgPSAxNjsgLy8gcHhcclxuXHRcdHRoaXMuY3Jvc3NTaXplID0gODsgLy8gcHhcclxuXHRcdHRoaXMuY2xvc2FibGUgPSBmYWxzZTsgLy8gd2hldGhlciB0byBkaXNwbGF5IHRoZSBDbG9zZSBidXR0b25cclxuXHRcdHRoaXMuY2xvc2VUZXh0ID0gJ0Nsb3NlJztcclxuXHRcdHRoaXMuYnV0dG9uQ29sb3IgPSAnIzAwMDAwMCc7IC8vIENTUyBjb2xvclxyXG5cdFx0dGhpcy5idXR0b25IZWlnaHQgPSAxODsgLy8gcHhcclxuXHRcdHRoaXMucGFkZGluZyA9IDEyOyAvLyBweFxyXG5cdFx0dGhpcy5iYWNrZ3JvdW5kQ29sb3IgPSAnI0ZGRkZGRic7IC8vIENTUyBjb2xvclxyXG5cdFx0dGhpcy5ib3JkZXJXaWR0aCA9IDE7IC8vIHB4XHJcblx0XHR0aGlzLmJvcmRlckNvbG9yID0gJyNCQkJCQkInOyAvLyBDU1MgY29sb3JcclxuXHRcdHRoaXMuYm9yZGVyUmFkaXVzID0gODsgLy8gcHhcclxuXHRcdHRoaXMuaW5zZXRXaWR0aCA9IDE7IC8vIHB4XHJcblx0XHR0aGlzLmluc2V0Q29sb3IgPSAnI0JCQkJCQic7IC8vIENTUyBjb2xvclxyXG5cdFx0dGhpcy5zaGFkb3cgPSB0cnVlOyAvLyB3aGV0aGVyIHRvIGRpc3BsYXkgc2hhZG93XHJcblx0XHR0aGlzLnNoYWRvd0JsdXIgPSAxNTsgLy8gcHhcclxuXHRcdHRoaXMuc2hhZG93Q29sb3IgPSAncmdiYSgwLDAsMCwwLjIpJzsgLy8gQ1NTIGNvbG9yXHJcblx0XHR0aGlzLnBvaW50ZXJDb2xvciA9ICcjNEM0QzRDJzsgLy8gcHhcclxuXHRcdHRoaXMucG9pbnRlckJvcmRlckNvbG9yID0gJyNGRkZGRkYnOyAvLyBweFxyXG4gICAgICAgIHRoaXMucG9pbnRlckJvcmRlcldpZHRoID0gMTsgLy8gcHhcclxuICAgICAgICB0aGlzLnBvaW50ZXJUaGlja25lc3MgPSAyOyAvLyBweFxyXG5cdFx0dGhpcy56SW5kZXggPSAxMDAwO1xyXG5cdFx0dGhpcy5jb250YWluZXIgPSBudWxsOyAvLyB3aGVyZSB0byBhcHBlbmQgdGhlIGNvbG9yIHBpY2tlciAoQk9EWSBlbGVtZW50IGJ5IGRlZmF1bHQpXHJcblxyXG5cclxuXHRcdGZvciAodmFyIG9wdCBpbiBvcHRpb25zKSB7XHJcblx0XHRcdGlmIChvcHRpb25zLmhhc093blByb3BlcnR5KG9wdCkpIHtcclxuXHRcdFx0XHR0aGlzW29wdF0gPSBvcHRpb25zW29wdF07XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblxyXG5cdFx0dGhpcy5oaWRlID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRpZiAoaXNQaWNrZXJPd25lcigpKSB7XHJcblx0XHRcdFx0ZGV0YWNoUGlja2VyKCk7XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblxyXG5cclxuXHRcdHRoaXMuc2hvdyA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0ZHJhd1BpY2tlcigpO1xyXG5cdFx0fTtcclxuXHJcblxyXG5cdFx0dGhpcy5yZWRyYXcgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGlmIChpc1BpY2tlck93bmVyKCkpIHtcclxuXHRcdFx0XHRkcmF3UGlja2VyKCk7XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblxyXG5cclxuXHRcdHRoaXMuaW1wb3J0Q29sb3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGlmICghdGhpcy52YWx1ZUVsZW1lbnQpIHtcclxuXHRcdFx0XHR0aGlzLmV4cG9ydENvbG9yKCk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0aWYgKGpzYy5pc0VsZW1lbnRUeXBlKHRoaXMudmFsdWVFbGVtZW50LCAnaW5wdXQnKSkge1xyXG5cdFx0XHRcdFx0aWYgKCF0aGlzLnJlZmluZSkge1xyXG5cdFx0XHRcdFx0XHRpZiAoIXRoaXMuZnJvbVN0cmluZyh0aGlzLnZhbHVlRWxlbWVudC52YWx1ZSwganNjLmxlYXZlVmFsdWUpKSB7XHJcblx0XHRcdFx0XHRcdFx0aWYgKHRoaXMuc3R5bGVFbGVtZW50KSB7XHJcblx0XHRcdFx0XHRcdFx0XHR0aGlzLnN0eWxlRWxlbWVudC5zdHlsZS5iYWNrZ3JvdW5kSW1hZ2UgPSB0aGlzLnN0eWxlRWxlbWVudC5fanNjT3JpZ1N0eWxlLmJhY2tncm91bmRJbWFnZTtcclxuXHRcdFx0XHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRDb2xvciA9IHRoaXMuc3R5bGVFbGVtZW50Ll9qc2NPcmlnU3R5bGUuYmFja2dyb3VuZENvbG9yO1xyXG5cdFx0XHRcdFx0XHRcdFx0dGhpcy5zdHlsZUVsZW1lbnQuc3R5bGUuY29sb3IgPSB0aGlzLnN0eWxlRWxlbWVudC5fanNjT3JpZ1N0eWxlLmNvbG9yO1xyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0XHR0aGlzLmV4cG9ydENvbG9yKGpzYy5sZWF2ZVZhbHVlIHwganNjLmxlYXZlU3R5bGUpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9IGVsc2UgaWYgKCF0aGlzLnJlcXVpcmVkICYmIC9eXFxzKiQvLnRlc3QodGhpcy52YWx1ZUVsZW1lbnQudmFsdWUpKSB7XHJcblx0XHRcdFx0XHRcdHRoaXMudmFsdWVFbGVtZW50LnZhbHVlID0gJyc7XHJcblx0XHRcdFx0XHRcdGlmICh0aGlzLnN0eWxlRWxlbWVudCkge1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRJbWFnZSA9IHRoaXMuc3R5bGVFbGVtZW50Ll9qc2NPcmlnU3R5bGUuYmFja2dyb3VuZEltYWdlO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRDb2xvciA9IHRoaXMuc3R5bGVFbGVtZW50Ll9qc2NPcmlnU3R5bGUuYmFja2dyb3VuZENvbG9yO1xyXG5cdFx0XHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmNvbG9yID0gdGhpcy5zdHlsZUVsZW1lbnQuX2pzY09yaWdTdHlsZS5jb2xvcjtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHR0aGlzLmV4cG9ydENvbG9yKGpzYy5sZWF2ZVZhbHVlIHwganNjLmxlYXZlU3R5bGUpO1xyXG5cclxuXHRcdFx0XHRcdH0gZWxzZSBpZiAodGhpcy5mcm9tU3RyaW5nKHRoaXMudmFsdWVFbGVtZW50LnZhbHVlKSkge1xyXG5cdFx0XHRcdFx0XHQvLyBtYW5hZ2VkIHRvIGltcG9ydCBjb2xvciBzdWNjZXNzZnVsbHkgZnJvbSB0aGUgdmFsdWUgLT4gT0ssIGRvbid0IGRvIGFueXRoaW5nXHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHR0aGlzLmV4cG9ydENvbG9yKCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRcdC8vIG5vdCBhbiBpbnB1dCBlbGVtZW50IC0+IGRvZXNuJ3QgaGF2ZSBhbnkgdmFsdWVcclxuXHRcdFx0XHRcdHRoaXMuZXhwb3J0Q29sb3IoKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblxyXG5cclxuXHRcdHRoaXMuZXhwb3J0Q29sb3IgPSBmdW5jdGlvbiAoZmxhZ3MpIHtcclxuXHRcdFx0aWYgKCEoZmxhZ3MgJiBqc2MubGVhdmVWYWx1ZSkgJiYgdGhpcy52YWx1ZUVsZW1lbnQpIHtcclxuXHRcdFx0XHR2YXIgdmFsdWUgPSB0aGlzLnRvU3RyaW5nKCk7XHJcblx0XHRcdFx0aWYgKHRoaXMudXBwZXJjYXNlKSB7IHZhbHVlID0gdmFsdWUudG9VcHBlckNhc2UoKTsgfVxyXG5cdFx0XHRcdGlmICh0aGlzLmhhc2gpIHsgdmFsdWUgPSAnIycgKyB2YWx1ZTsgfVxyXG5cclxuXHRcdFx0XHRpZiAoanNjLmlzRWxlbWVudFR5cGUodGhpcy52YWx1ZUVsZW1lbnQsICdpbnB1dCcpKSB7XHJcblx0XHRcdFx0XHR0aGlzLnZhbHVlRWxlbWVudC52YWx1ZSA9IHZhbHVlO1xyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHR0aGlzLnZhbHVlRWxlbWVudC5pbm5lckhUTUwgPSB2YWx1ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKCEoZmxhZ3MgJiBqc2MubGVhdmVTdHlsZSkpIHtcclxuXHRcdFx0XHRpZiAodGhpcy5zdHlsZUVsZW1lbnQpIHtcclxuXHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRJbWFnZSA9ICdub25lJztcclxuXHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRDb2xvciA9ICcjJyArIHRoaXMudG9TdHJpbmcoKTtcclxuXHRcdFx0XHRcdHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmNvbG9yID0gdGhpcy5pc0xpZ2h0KCkgPyAnIzAwMCcgOiAnI0ZGRic7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHRcdGlmICghKGZsYWdzICYganNjLmxlYXZlUGFkKSAmJiBpc1BpY2tlck93bmVyKCkpIHtcclxuXHRcdFx0XHRyZWRyYXdQYWQoKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoIShmbGFncyAmIGpzYy5sZWF2ZVNsZCkgJiYgaXNQaWNrZXJPd25lcigpKSB7XHJcblx0XHRcdFx0cmVkcmF3U2xkKCk7XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblxyXG5cclxuXHRcdC8vIGg6IDAtMzYwXHJcblx0XHQvLyBzOiAwLTEwMFxyXG5cdFx0Ly8gdjogMC0xMDBcclxuXHRcdC8vXHJcblx0XHR0aGlzLmZyb21IU1YgPSBmdW5jdGlvbiAoaCwgcywgdiwgZmxhZ3MpIHsgLy8gbnVsbCA9IGRvbid0IGNoYW5nZVxyXG5cdFx0XHRpZiAoaCAhPT0gbnVsbCkge1xyXG5cdFx0XHRcdGlmIChpc05hTihoKSkgeyByZXR1cm4gZmFsc2U7IH1cclxuXHRcdFx0XHRoID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMzYwLCBoKSk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKHMgIT09IG51bGwpIHtcclxuXHRcdFx0XHRpZiAoaXNOYU4ocykpIHsgcmV0dXJuIGZhbHNlOyB9XHJcblx0XHRcdFx0cyA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgdGhpcy5tYXhTLCBzKSwgdGhpcy5taW5TKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAodiAhPT0gbnVsbCkge1xyXG5cdFx0XHRcdGlmIChpc05hTih2KSkgeyByZXR1cm4gZmFsc2U7IH1cclxuXHRcdFx0XHR2ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCB0aGlzLm1heFYsIHYpLCB0aGlzLm1pblYpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR0aGlzLnJnYiA9IEhTVl9SR0IoXHJcblx0XHRcdFx0aD09PW51bGwgPyB0aGlzLmhzdlswXSA6ICh0aGlzLmhzdlswXT1oKSxcclxuXHRcdFx0XHRzPT09bnVsbCA/IHRoaXMuaHN2WzFdIDogKHRoaXMuaHN2WzFdPXMpLFxyXG5cdFx0XHRcdHY9PT1udWxsID8gdGhpcy5oc3ZbMl0gOiAodGhpcy5oc3ZbMl09dilcclxuXHRcdFx0KTtcclxuXHJcblx0XHRcdHRoaXMuZXhwb3J0Q29sb3IoZmxhZ3MpO1xyXG5cdFx0fTtcclxuXHJcblxyXG5cdFx0Ly8gcjogMC0yNTVcclxuXHRcdC8vIGc6IDAtMjU1XHJcblx0XHQvLyBiOiAwLTI1NVxyXG5cdFx0Ly9cclxuXHRcdHRoaXMuZnJvbVJHQiA9IGZ1bmN0aW9uIChyLCBnLCBiLCBmbGFncykgeyAvLyBudWxsID0gZG9uJ3QgY2hhbmdlXHJcblx0XHRcdGlmIChyICE9PSBudWxsKSB7XHJcblx0XHRcdFx0aWYgKGlzTmFOKHIpKSB7IHJldHVybiBmYWxzZTsgfVxyXG5cdFx0XHRcdHIgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigyNTUsIHIpKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRpZiAoZyAhPT0gbnVsbCkge1xyXG5cdFx0XHRcdGlmIChpc05hTihnKSkgeyByZXR1cm4gZmFsc2U7IH1cclxuXHRcdFx0XHRnID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBnKSk7XHJcblx0XHRcdH1cclxuXHRcdFx0aWYgKGIgIT09IG51bGwpIHtcclxuXHRcdFx0XHRpZiAoaXNOYU4oYikpIHsgcmV0dXJuIGZhbHNlOyB9XHJcblx0XHRcdFx0YiA9IE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgYikpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgaHN2ID0gUkdCX0hTVihcclxuXHRcdFx0XHRyPT09bnVsbCA/IHRoaXMucmdiWzBdIDogcixcclxuXHRcdFx0XHRnPT09bnVsbCA/IHRoaXMucmdiWzFdIDogZyxcclxuXHRcdFx0XHRiPT09bnVsbCA/IHRoaXMucmdiWzJdIDogYlxyXG5cdFx0XHQpO1xyXG5cdFx0XHRpZiAoaHN2WzBdICE9PSBudWxsKSB7XHJcblx0XHRcdFx0dGhpcy5oc3ZbMF0gPSBNYXRoLm1heCgwLCBNYXRoLm1pbigzNjAsIGhzdlswXSkpO1xyXG5cdFx0XHR9XHJcblx0XHRcdGlmIChoc3ZbMl0gIT09IDApIHtcclxuXHRcdFx0XHR0aGlzLmhzdlsxXSA9IGhzdlsxXT09PW51bGwgPyBudWxsIDogTWF0aC5tYXgoMCwgdGhpcy5taW5TLCBNYXRoLm1pbigxMDAsIHRoaXMubWF4UywgaHN2WzFdKSk7XHJcblx0XHRcdH1cclxuXHRcdFx0dGhpcy5oc3ZbMl0gPSBoc3ZbMl09PT1udWxsID8gbnVsbCA6IE1hdGgubWF4KDAsIHRoaXMubWluViwgTWF0aC5taW4oMTAwLCB0aGlzLm1heFYsIGhzdlsyXSkpO1xyXG5cclxuXHRcdFx0Ly8gdXBkYXRlIFJHQiBhY2NvcmRpbmcgdG8gZmluYWwgSFNWLCBhcyBzb21lIHZhbHVlcyBtaWdodCBiZSB0cmltbWVkXHJcblx0XHRcdHZhciByZ2IgPSBIU1ZfUkdCKHRoaXMuaHN2WzBdLCB0aGlzLmhzdlsxXSwgdGhpcy5oc3ZbMl0pO1xyXG5cdFx0XHR0aGlzLnJnYlswXSA9IHJnYlswXTtcclxuXHRcdFx0dGhpcy5yZ2JbMV0gPSByZ2JbMV07XHJcblx0XHRcdHRoaXMucmdiWzJdID0gcmdiWzJdO1xyXG5cclxuXHRcdFx0dGhpcy5leHBvcnRDb2xvcihmbGFncyk7XHJcblx0XHR9O1xyXG5cclxuXHJcblx0XHR0aGlzLmZyb21TdHJpbmcgPSBmdW5jdGlvbiAoc3RyLCBmbGFncykge1xyXG5cdFx0XHR2YXIgbTtcclxuXHRcdFx0aWYgKG0gPSBzdHIubWF0Y2goL15cXFcqKFswLTlBLUZdezN9KFswLTlBLUZdezN9KT8pXFxXKiQvaSkpIHtcclxuXHRcdFx0XHQvLyBIRVggbm90YXRpb25cclxuXHRcdFx0XHQvL1xyXG5cclxuXHRcdFx0XHRpZiAobVsxXS5sZW5ndGggPT09IDYpIHtcclxuXHRcdFx0XHRcdC8vIDYtY2hhciBub3RhdGlvblxyXG5cdFx0XHRcdFx0dGhpcy5mcm9tUkdCKFxyXG5cdFx0XHRcdFx0XHRwYXJzZUludChtWzFdLnN1YnN0cigwLDIpLDE2KSxcclxuXHRcdFx0XHRcdFx0cGFyc2VJbnQobVsxXS5zdWJzdHIoMiwyKSwxNiksXHJcblx0XHRcdFx0XHRcdHBhcnNlSW50KG1bMV0uc3Vic3RyKDQsMiksMTYpLFxyXG5cdFx0XHRcdFx0XHRmbGFnc1xyXG5cdFx0XHRcdFx0KTtcclxuXHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0Ly8gMy1jaGFyIG5vdGF0aW9uXHJcblx0XHRcdFx0XHR0aGlzLmZyb21SR0IoXHJcblx0XHRcdFx0XHRcdHBhcnNlSW50KG1bMV0uY2hhckF0KDApICsgbVsxXS5jaGFyQXQoMCksMTYpLFxyXG5cdFx0XHRcdFx0XHRwYXJzZUludChtWzFdLmNoYXJBdCgxKSArIG1bMV0uY2hhckF0KDEpLDE2KSxcclxuXHRcdFx0XHRcdFx0cGFyc2VJbnQobVsxXS5jaGFyQXQoMikgKyBtWzFdLmNoYXJBdCgyKSwxNiksXHJcblx0XHRcdFx0XHRcdGZsYWdzXHJcblx0XHRcdFx0XHQpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHJcblx0XHRcdH0gZWxzZSBpZiAobSA9IHN0ci5tYXRjaCgvXlxcVypyZ2JhP1xcKChbXildKilcXClcXFcqJC9pKSkge1xyXG5cdFx0XHRcdHZhciBwYXJhbXMgPSBtWzFdLnNwbGl0KCcsJyk7XHJcblx0XHRcdFx0dmFyIHJlID0gL15cXHMqKFxcZCopKFxcLlxcZCspP1xccyokLztcclxuXHRcdFx0XHR2YXIgbVIsIG1HLCBtQjtcclxuXHRcdFx0XHRpZiAoXHJcblx0XHRcdFx0XHRwYXJhbXMubGVuZ3RoID49IDMgJiZcclxuXHRcdFx0XHRcdChtUiA9IHBhcmFtc1swXS5tYXRjaChyZSkpICYmXHJcblx0XHRcdFx0XHQobUcgPSBwYXJhbXNbMV0ubWF0Y2gocmUpKSAmJlxyXG5cdFx0XHRcdFx0KG1CID0gcGFyYW1zWzJdLm1hdGNoKHJlKSlcclxuXHRcdFx0XHQpIHtcclxuXHRcdFx0XHRcdHZhciByID0gcGFyc2VGbG9hdCgobVJbMV0gfHwgJzAnKSArIChtUlsyXSB8fCAnJykpO1xyXG5cdFx0XHRcdFx0dmFyIGcgPSBwYXJzZUZsb2F0KChtR1sxXSB8fCAnMCcpICsgKG1HWzJdIHx8ICcnKSk7XHJcblx0XHRcdFx0XHR2YXIgYiA9IHBhcnNlRmxvYXQoKG1CWzFdIHx8ICcwJykgKyAobUJbMl0gfHwgJycpKTtcclxuXHRcdFx0XHRcdHRoaXMuZnJvbVJHQihyLCBnLCBiLCBmbGFncyk7XHJcblx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fTtcclxuXHJcblxyXG5cdFx0dGhpcy50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0cmV0dXJuIChcclxuXHRcdFx0XHQoMHgxMDAgfCBNYXRoLnJvdW5kKHRoaXMucmdiWzBdKSkudG9TdHJpbmcoMTYpLnN1YnN0cigxKSArXHJcblx0XHRcdFx0KDB4MTAwIHwgTWF0aC5yb3VuZCh0aGlzLnJnYlsxXSkpLnRvU3RyaW5nKDE2KS5zdWJzdHIoMSkgK1xyXG5cdFx0XHRcdCgweDEwMCB8IE1hdGgucm91bmQodGhpcy5yZ2JbMl0pKS50b1N0cmluZygxNikuc3Vic3RyKDEpXHJcblx0XHRcdCk7XHJcblx0XHR9O1xyXG5cclxuXHJcblx0XHR0aGlzLnRvSEVYU3RyaW5nID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRyZXR1cm4gJyMnICsgdGhpcy50b1N0cmluZygpLnRvVXBwZXJDYXNlKCk7XHJcblx0XHR9O1xyXG5cclxuXHJcblx0XHR0aGlzLnRvUkdCU3RyaW5nID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRyZXR1cm4gKCdyZ2IoJyArXHJcblx0XHRcdFx0TWF0aC5yb3VuZCh0aGlzLnJnYlswXSkgKyAnLCcgK1xyXG5cdFx0XHRcdE1hdGgucm91bmQodGhpcy5yZ2JbMV0pICsgJywnICtcclxuXHRcdFx0XHRNYXRoLnJvdW5kKHRoaXMucmdiWzJdKSArICcpJ1xyXG5cdFx0XHQpO1xyXG5cdFx0fTtcclxuXHJcblxyXG5cdFx0dGhpcy5pc0xpZ2h0ID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRyZXR1cm4gKFxyXG5cdFx0XHRcdDAuMjEzICogdGhpcy5yZ2JbMF0gK1xyXG5cdFx0XHRcdDAuNzE1ICogdGhpcy5yZ2JbMV0gK1xyXG5cdFx0XHRcdDAuMDcyICogdGhpcy5yZ2JbMl0gPlxyXG5cdFx0XHRcdDI1NSAvIDJcclxuXHRcdFx0KTtcclxuXHRcdH07XHJcblxyXG5cclxuXHRcdHRoaXMuX3Byb2Nlc3NQYXJlbnRFbGVtZW50c0luRE9NID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRpZiAodGhpcy5fbGlua2VkRWxlbWVudHNQcm9jZXNzZWQpIHsgcmV0dXJuOyB9XHJcblx0XHRcdHRoaXMuX2xpbmtlZEVsZW1lbnRzUHJvY2Vzc2VkID0gdHJ1ZTtcclxuXHJcblx0XHRcdHZhciBlbG0gPSB0aGlzLnRhcmdldEVsZW1lbnQ7XHJcblx0XHRcdGRvIHtcclxuXHRcdFx0XHQvLyBJZiB0aGUgdGFyZ2V0IGVsZW1lbnQgb3Igb25lIG9mIGl0cyBwYXJlbnQgbm9kZXMgaGFzIGZpeGVkIHBvc2l0aW9uLFxyXG5cdFx0XHRcdC8vIHRoZW4gdXNlIGZpeGVkIHBvc2l0aW9uaW5nIGluc3RlYWRcclxuXHRcdFx0XHQvL1xyXG5cdFx0XHRcdC8vIE5vdGU6IEluIEZpcmVmb3gsIGdldENvbXB1dGVkU3R5bGUgcmV0dXJucyBudWxsIGluIGEgaGlkZGVuIGlmcmFtZSxcclxuXHRcdFx0XHQvLyB0aGF0J3Mgd2h5IHdlIG5lZWQgdG8gY2hlY2sgaWYgdGhlIHJldHVybmVkIHN0eWxlIG9iamVjdCBpcyBub24tZW1wdHlcclxuXHRcdFx0XHR2YXIgY3VyclN0eWxlID0ganNjLmdldFN0eWxlKGVsbSk7XHJcblx0XHRcdFx0aWYgKGN1cnJTdHlsZSAmJiBjdXJyU3R5bGUucG9zaXRpb24udG9Mb3dlckNhc2UoKSA9PT0gJ2ZpeGVkJykge1xyXG5cdFx0XHRcdFx0dGhpcy5maXhlZCA9IHRydWU7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRpZiAoZWxtICE9PSB0aGlzLnRhcmdldEVsZW1lbnQpIHtcclxuXHRcdFx0XHRcdC8vIEVuc3VyZSB0byBhdHRhY2ggb25QYXJlbnRTY3JvbGwgb25seSBvbmNlIHRvIGVhY2ggcGFyZW50IGVsZW1lbnRcclxuXHRcdFx0XHRcdC8vIChtdWx0aXBsZSB0YXJnZXRFbGVtZW50cyBjYW4gc2hhcmUgdGhlIHNhbWUgcGFyZW50IG5vZGVzKVxyXG5cdFx0XHRcdFx0Ly9cclxuXHRcdFx0XHRcdC8vIE5vdGU6IEl0J3Mgbm90IGp1c3Qgb2Zmc2V0UGFyZW50cyB0aGF0IGNhbiBiZSBzY3JvbGxhYmxlLFxyXG5cdFx0XHRcdFx0Ly8gdGhhdCdzIHdoeSB3ZSBsb29wIHRocm91Z2ggYWxsIHBhcmVudCBub2Rlc1xyXG5cdFx0XHRcdFx0aWYgKCFlbG0uX2pzY0V2ZW50c0F0dGFjaGVkKSB7XHJcblx0XHRcdFx0XHRcdGpzYy5hdHRhY2hFdmVudChlbG0sICdzY3JvbGwnLCBqc2Mub25QYXJlbnRTY3JvbGwpO1xyXG5cdFx0XHRcdFx0XHRlbG0uX2pzY0V2ZW50c0F0dGFjaGVkID0gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH0gd2hpbGUgKChlbG0gPSBlbG0ucGFyZW50Tm9kZSkgJiYgIWpzYy5pc0VsZW1lbnRUeXBlKGVsbSwgJ2JvZHknKSk7XHJcblx0XHR9O1xyXG5cclxuXHJcblx0XHQvLyByOiAwLTI1NVxyXG5cdFx0Ly8gZzogMC0yNTVcclxuXHRcdC8vIGI6IDAtMjU1XHJcblx0XHQvL1xyXG5cdFx0Ly8gcmV0dXJuczogWyAwLTM2MCwgMC0xMDAsIDAtMTAwIF1cclxuXHRcdC8vXHJcblx0XHRmdW5jdGlvbiBSR0JfSFNWIChyLCBnLCBiKSB7XHJcblx0XHRcdHIgLz0gMjU1O1xyXG5cdFx0XHRnIC89IDI1NTtcclxuXHRcdFx0YiAvPSAyNTU7XHJcblx0XHRcdHZhciBuID0gTWF0aC5taW4oTWF0aC5taW4ocixnKSxiKTtcclxuXHRcdFx0dmFyIHYgPSBNYXRoLm1heChNYXRoLm1heChyLGcpLGIpO1xyXG5cdFx0XHR2YXIgbSA9IHYgLSBuO1xyXG5cdFx0XHRpZiAobSA9PT0gMCkgeyByZXR1cm4gWyBudWxsLCAwLCAxMDAgKiB2IF07IH1cclxuXHRcdFx0dmFyIGggPSByPT09biA/IDMrKGItZykvbSA6IChnPT09biA/IDUrKHItYikvbSA6IDErKGctcikvbSk7XHJcblx0XHRcdHJldHVybiBbXHJcblx0XHRcdFx0NjAgKiAoaD09PTY/MDpoKSxcclxuXHRcdFx0XHQxMDAgKiAobS92KSxcclxuXHRcdFx0XHQxMDAgKiB2XHJcblx0XHRcdF07XHJcblx0XHR9XHJcblxyXG5cclxuXHRcdC8vIGg6IDAtMzYwXHJcblx0XHQvLyBzOiAwLTEwMFxyXG5cdFx0Ly8gdjogMC0xMDBcclxuXHRcdC8vXHJcblx0XHQvLyByZXR1cm5zOiBbIDAtMjU1LCAwLTI1NSwgMC0yNTUgXVxyXG5cdFx0Ly9cclxuXHRcdGZ1bmN0aW9uIEhTVl9SR0IgKGgsIHMsIHYpIHtcclxuXHRcdFx0dmFyIHUgPSAyNTUgKiAodiAvIDEwMCk7XHJcblxyXG5cdFx0XHRpZiAoaCA9PT0gbnVsbCkge1xyXG5cdFx0XHRcdHJldHVybiBbIHUsIHUsIHUgXTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0aCAvPSA2MDtcclxuXHRcdFx0cyAvPSAxMDA7XHJcblxyXG5cdFx0XHR2YXIgaSA9IE1hdGguZmxvb3IoaCk7XHJcblx0XHRcdHZhciBmID0gaSUyID8gaC1pIDogMS0oaC1pKTtcclxuXHRcdFx0dmFyIG0gPSB1ICogKDEgLSBzKTtcclxuXHRcdFx0dmFyIG4gPSB1ICogKDEgLSBzICogZik7XHJcblx0XHRcdHN3aXRjaCAoaSkge1xyXG5cdFx0XHRcdGNhc2UgNjpcclxuXHRcdFx0XHRjYXNlIDA6IHJldHVybiBbdSxuLG1dO1xyXG5cdFx0XHRcdGNhc2UgMTogcmV0dXJuIFtuLHUsbV07XHJcblx0XHRcdFx0Y2FzZSAyOiByZXR1cm4gW20sdSxuXTtcclxuXHRcdFx0XHRjYXNlIDM6IHJldHVybiBbbSxuLHVdO1xyXG5cdFx0XHRcdGNhc2UgNDogcmV0dXJuIFtuLG0sdV07XHJcblx0XHRcdFx0Y2FzZSA1OiByZXR1cm4gW3UsbSxuXTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHJcblx0XHRmdW5jdGlvbiBkZXRhY2hQaWNrZXIgKCkge1xyXG5cdFx0XHRqc2MudW5zZXRDbGFzcyhUSElTLnRhcmdldEVsZW1lbnQsIFRISVMuYWN0aXZlQ2xhc3MpO1xyXG5cdFx0XHRqc2MucGlja2VyLndyYXAucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChqc2MucGlja2VyLndyYXApO1xyXG5cdFx0XHRkZWxldGUganNjLnBpY2tlci5vd25lcjtcclxuXHRcdH1cclxuXHJcblxyXG5cdFx0ZnVuY3Rpb24gZHJhd1BpY2tlciAoKSB7XHJcblxyXG5cdFx0XHQvLyBBdCB0aGlzIHBvaW50LCB3aGVuIGRyYXdpbmcgdGhlIHBpY2tlciwgd2Uga25vdyB3aGF0IHRoZSBwYXJlbnQgZWxlbWVudHMgYXJlXHJcblx0XHRcdC8vIGFuZCB3ZSBjYW4gZG8gYWxsIHJlbGF0ZWQgRE9NIG9wZXJhdGlvbnMsIHN1Y2ggYXMgcmVnaXN0ZXJpbmcgZXZlbnRzIG9uIHRoZW1cclxuXHRcdFx0Ly8gb3IgY2hlY2tpbmcgdGhlaXIgcG9zaXRpb25pbmdcclxuXHRcdFx0VEhJUy5fcHJvY2Vzc1BhcmVudEVsZW1lbnRzSW5ET00oKTtcclxuXHJcblx0XHRcdGlmICghanNjLnBpY2tlcikge1xyXG5cdFx0XHRcdGpzYy5waWNrZXIgPSB7XHJcblx0XHRcdFx0XHRvd25lcjogbnVsbCxcclxuXHRcdFx0XHRcdHdyYXAgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSxcclxuXHRcdFx0XHRcdGJveCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG5cdFx0XHRcdFx0Ym94UyA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBzaGFkb3cgYXJlYVxyXG5cdFx0XHRcdFx0Ym94QiA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBib3JkZXJcclxuXHRcdFx0XHRcdHBhZCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG5cdFx0XHRcdFx0cGFkQiA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBib3JkZXJcclxuXHRcdFx0XHRcdHBhZE0gOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSwgLy8gbW91c2UvdG91Y2ggYXJlYVxyXG5cdFx0XHRcdFx0cGFkUGFsIDoganNjLmNyZWF0ZVBhbGV0dGUoKSxcclxuXHRcdFx0XHRcdGNyb3NzIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcblx0XHRcdFx0XHRjcm9zc0JZIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksIC8vIGJvcmRlciBZXHJcblx0XHRcdFx0XHRjcm9zc0JYIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksIC8vIGJvcmRlciBYXHJcblx0XHRcdFx0XHRjcm9zc0xZIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksIC8vIGxpbmUgWVxyXG5cdFx0XHRcdFx0Y3Jvc3NMWCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBsaW5lIFhcclxuXHRcdFx0XHRcdHNsZCA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG5cdFx0XHRcdFx0c2xkQiA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBib3JkZXJcclxuXHRcdFx0XHRcdHNsZE0gOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSwgLy8gbW91c2UvdG91Y2ggYXJlYVxyXG5cdFx0XHRcdFx0c2xkR3JhZCA6IGpzYy5jcmVhdGVTbGlkZXJHcmFkaWVudCgpLFxyXG5cdFx0XHRcdFx0c2xkUHRyUyA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLCAvLyBzbGlkZXIgcG9pbnRlciBzcGFjZXJcclxuXHRcdFx0XHRcdHNsZFB0cklCIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksIC8vIHNsaWRlciBwb2ludGVyIGlubmVyIGJvcmRlclxyXG5cdFx0XHRcdFx0c2xkUHRyTUIgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSwgLy8gc2xpZGVyIHBvaW50ZXIgbWlkZGxlIGJvcmRlclxyXG5cdFx0XHRcdFx0c2xkUHRyT0IgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSwgLy8gc2xpZGVyIHBvaW50ZXIgb3V0ZXIgYm9yZGVyXHJcblx0XHRcdFx0XHRidG4gOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSxcclxuXHRcdFx0XHRcdGJ0blQgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJykgLy8gdGV4dFxyXG5cdFx0XHRcdH07XHJcblxyXG5cdFx0XHRcdGpzYy5waWNrZXIucGFkLmFwcGVuZENoaWxkKGpzYy5waWNrZXIucGFkUGFsLmVsbSk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5wYWRCLmFwcGVuZENoaWxkKGpzYy5waWNrZXIucGFkKTtcclxuXHRcdFx0XHRqc2MucGlja2VyLmNyb3NzLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuY3Jvc3NCWSk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5jcm9zcy5hcHBlbmRDaGlsZChqc2MucGlja2VyLmNyb3NzQlgpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIuY3Jvc3MuYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5jcm9zc0xZKTtcclxuXHRcdFx0XHRqc2MucGlja2VyLmNyb3NzLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuY3Jvc3NMWCk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5wYWRCLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuY3Jvc3MpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIuYm94LmFwcGVuZENoaWxkKGpzYy5waWNrZXIucGFkQik7XHJcblx0XHRcdFx0anNjLnBpY2tlci5ib3guYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5wYWRNKTtcclxuXHJcblx0XHRcdFx0anNjLnBpY2tlci5zbGQuYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5zbGRHcmFkLmVsbSk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5zbGRCLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuc2xkKTtcclxuXHRcdFx0XHRqc2MucGlja2VyLnNsZEIuYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5zbGRQdHJPQik7XHJcblx0XHRcdFx0anNjLnBpY2tlci5zbGRQdHJPQi5hcHBlbmRDaGlsZChqc2MucGlja2VyLnNsZFB0ck1CKTtcclxuXHRcdFx0XHRqc2MucGlja2VyLnNsZFB0ck1CLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuc2xkUHRySUIpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIuc2xkUHRySUIuYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5zbGRQdHJTKTtcclxuXHRcdFx0XHRqc2MucGlja2VyLmJveC5hcHBlbmRDaGlsZChqc2MucGlja2VyLnNsZEIpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIuYm94LmFwcGVuZENoaWxkKGpzYy5waWNrZXIuc2xkTSk7XHJcblxyXG5cdFx0XHRcdGpzYy5waWNrZXIuYnRuLmFwcGVuZENoaWxkKGpzYy5waWNrZXIuYnRuVCk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5ib3guYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5idG4pO1xyXG5cclxuXHRcdFx0XHRqc2MucGlja2VyLmJveEIuYXBwZW5kQ2hpbGQoanNjLnBpY2tlci5ib3gpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIud3JhcC5hcHBlbmRDaGlsZChqc2MucGlja2VyLmJveFMpO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIud3JhcC5hcHBlbmRDaGlsZChqc2MucGlja2VyLmJveEIpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgcCA9IGpzYy5waWNrZXI7XHJcblxyXG5cdFx0XHR2YXIgZGlzcGxheVNsaWRlciA9ICEhanNjLmdldFNsaWRlckNvbXBvbmVudChUSElTKTtcclxuXHRcdFx0dmFyIGRpbXMgPSBqc2MuZ2V0UGlja2VyRGltcyhUSElTKTtcclxuXHRcdFx0dmFyIGNyb3NzT3V0ZXJTaXplID0gKDIgKiBUSElTLnBvaW50ZXJCb3JkZXJXaWR0aCArIFRISVMucG9pbnRlclRoaWNrbmVzcyArIDIgKiBUSElTLmNyb3NzU2l6ZSk7XHJcblx0XHRcdHZhciBwYWRUb1NsaWRlclBhZGRpbmcgPSBqc2MuZ2V0UGFkVG9TbGlkZXJQYWRkaW5nKFRISVMpO1xyXG5cdFx0XHR2YXIgYm9yZGVyUmFkaXVzID0gTWF0aC5taW4oXHJcblx0XHRcdFx0VEhJUy5ib3JkZXJSYWRpdXMsXHJcblx0XHRcdFx0TWF0aC5yb3VuZChUSElTLnBhZGRpbmcgKiBNYXRoLlBJKSk7IC8vIHB4XHJcblx0XHRcdHZhciBwYWRDdXJzb3IgPSAnY3Jvc3NoYWlyJztcclxuXHJcblx0XHRcdC8vIHdyYXBcclxuXHRcdFx0cC53cmFwLnN0eWxlLmNsZWFyID0gJ2JvdGgnO1xyXG5cdFx0XHRwLndyYXAuc3R5bGUud2lkdGggPSAoZGltc1swXSArIDIgKiBUSElTLmJvcmRlcldpZHRoKSArICdweCc7XHJcblx0XHRcdHAud3JhcC5zdHlsZS5oZWlnaHQgPSAoZGltc1sxXSArIDIgKiBUSElTLmJvcmRlcldpZHRoKSArICdweCc7XHJcblx0XHRcdHAud3JhcC5zdHlsZS56SW5kZXggPSBUSElTLnpJbmRleDtcclxuXHJcblx0XHRcdC8vIHBpY2tlclxyXG5cdFx0XHRwLmJveC5zdHlsZS53aWR0aCA9IGRpbXNbMF0gKyAncHgnO1xyXG5cdFx0XHRwLmJveC5zdHlsZS5oZWlnaHQgPSBkaW1zWzFdICsgJ3B4JztcclxuXHJcblx0XHRcdHAuYm94Uy5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XHJcblx0XHRcdHAuYm94Uy5zdHlsZS5sZWZ0ID0gJzAnO1xyXG5cdFx0XHRwLmJveFMuc3R5bGUudG9wID0gJzAnO1xyXG5cdFx0XHRwLmJveFMuc3R5bGUud2lkdGggPSAnMTAwJSc7XHJcblx0XHRcdHAuYm94Uy5zdHlsZS5oZWlnaHQgPSAnMTAwJSc7XHJcblx0XHRcdGpzYy5zZXRCb3JkZXJSYWRpdXMocC5ib3hTLCBib3JkZXJSYWRpdXMgKyAncHgnKTtcclxuXHJcblx0XHRcdC8vIHBpY2tlciBib3JkZXJcclxuXHRcdFx0cC5ib3hCLnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcclxuXHRcdFx0cC5ib3hCLnN0eWxlLmJvcmRlciA9IFRISVMuYm9yZGVyV2lkdGggKyAncHggc29saWQnO1xyXG5cdFx0XHRwLmJveEIuc3R5bGUuYm9yZGVyQ29sb3IgPSBUSElTLmJvcmRlckNvbG9yO1xyXG5cdFx0XHRwLmJveEIuc3R5bGUuYmFja2dyb3VuZCA9IFRISVMuYmFja2dyb3VuZENvbG9yO1xyXG5cdFx0XHRqc2Muc2V0Qm9yZGVyUmFkaXVzKHAuYm94QiwgYm9yZGVyUmFkaXVzICsgJ3B4Jyk7XHJcblxyXG5cdFx0XHQvLyBJRSBoYWNrOlxyXG5cdFx0XHQvLyBJZiB0aGUgZWxlbWVudCBpcyB0cmFuc3BhcmVudCwgSUUgd2lsbCB0cmlnZ2VyIHRoZSBldmVudCBvbiB0aGUgZWxlbWVudHMgdW5kZXIgaXQsXHJcblx0XHRcdC8vIGUuZy4gb24gQ2FudmFzIG9yIG9uIGVsZW1lbnRzIHdpdGggYm9yZGVyXHJcblx0XHRcdHAucGFkTS5zdHlsZS5iYWNrZ3JvdW5kID1cclxuXHRcdFx0cC5zbGRNLnN0eWxlLmJhY2tncm91bmQgPVxyXG5cdFx0XHRcdCcjRkZGJztcclxuXHRcdFx0anNjLnNldFN0eWxlKHAucGFkTSwgJ29wYWNpdHknLCAnMCcpO1xyXG5cdFx0XHRqc2Muc2V0U3R5bGUocC5zbGRNLCAnb3BhY2l0eScsICcwJyk7XHJcblxyXG5cdFx0XHQvLyBwYWRcclxuXHRcdFx0cC5wYWQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xyXG5cdFx0XHRwLnBhZC5zdHlsZS53aWR0aCA9IFRISVMud2lkdGggKyAncHgnO1xyXG5cdFx0XHRwLnBhZC5zdHlsZS5oZWlnaHQgPSBUSElTLmhlaWdodCArICdweCc7XHJcblxyXG5cdFx0XHQvLyBwYWQgcGFsZXR0ZXMgKEhTViBhbmQgSFZTKVxyXG5cdFx0XHRwLnBhZFBhbC5kcmF3KFRISVMud2lkdGgsIFRISVMuaGVpZ2h0LCBqc2MuZ2V0UGFkWUNvbXBvbmVudChUSElTKSk7XHJcblxyXG5cdFx0XHQvLyBwYWQgYm9yZGVyXHJcblx0XHRcdHAucGFkQi5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XHJcblx0XHRcdHAucGFkQi5zdHlsZS5sZWZ0ID0gVEhJUy5wYWRkaW5nICsgJ3B4JztcclxuXHRcdFx0cC5wYWRCLnN0eWxlLnRvcCA9IFRISVMucGFkZGluZyArICdweCc7XHJcblx0XHRcdHAucGFkQi5zdHlsZS5ib3JkZXIgPSBUSElTLmluc2V0V2lkdGggKyAncHggc29saWQnO1xyXG5cdFx0XHRwLnBhZEIuc3R5bGUuYm9yZGVyQ29sb3IgPSBUSElTLmluc2V0Q29sb3I7XHJcblxyXG5cdFx0XHQvLyBwYWQgbW91c2UgYXJlYVxyXG5cdFx0XHRwLnBhZE0uX2pzY0luc3RhbmNlID0gVEhJUztcclxuXHRcdFx0cC5wYWRNLl9qc2NDb250cm9sTmFtZSA9ICdwYWQnO1xyXG5cdFx0XHRwLnBhZE0uc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xyXG5cdFx0XHRwLnBhZE0uc3R5bGUubGVmdCA9ICcwJztcclxuXHRcdFx0cC5wYWRNLnN0eWxlLnRvcCA9ICcwJztcclxuXHRcdFx0cC5wYWRNLnN0eWxlLndpZHRoID0gKFRISVMucGFkZGluZyArIDIgKiBUSElTLmluc2V0V2lkdGggKyBUSElTLndpZHRoICsgcGFkVG9TbGlkZXJQYWRkaW5nIC8gMikgKyAncHgnO1xyXG5cdFx0XHRwLnBhZE0uc3R5bGUuaGVpZ2h0ID0gZGltc1sxXSArICdweCc7XHJcblx0XHRcdHAucGFkTS5zdHlsZS5jdXJzb3IgPSBwYWRDdXJzb3I7XHJcblxyXG5cdFx0XHQvLyBwYWQgY3Jvc3NcclxuXHRcdFx0cC5jcm9zcy5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XHJcblx0XHRcdHAuY3Jvc3Muc3R5bGUubGVmdCA9XHJcblx0XHRcdHAuY3Jvc3Muc3R5bGUudG9wID1cclxuXHRcdFx0XHQnMCc7XHJcblx0XHRcdHAuY3Jvc3Muc3R5bGUud2lkdGggPVxyXG5cdFx0XHRwLmNyb3NzLnN0eWxlLmhlaWdodCA9XHJcblx0XHRcdFx0Y3Jvc3NPdXRlclNpemUgKyAncHgnO1xyXG5cclxuXHRcdFx0Ly8gcGFkIGNyb3NzIGJvcmRlciBZIGFuZCBYXHJcblx0XHRcdHAuY3Jvc3NCWS5zdHlsZS5wb3NpdGlvbiA9XHJcblx0XHRcdHAuY3Jvc3NCWC5zdHlsZS5wb3NpdGlvbiA9XHJcblx0XHRcdFx0J2Fic29sdXRlJztcclxuXHRcdFx0cC5jcm9zc0JZLnN0eWxlLmJhY2tncm91bmQgPVxyXG5cdFx0XHRwLmNyb3NzQlguc3R5bGUuYmFja2dyb3VuZCA9XHJcblx0XHRcdFx0VEhJUy5wb2ludGVyQm9yZGVyQ29sb3I7XHJcblx0XHRcdHAuY3Jvc3NCWS5zdHlsZS53aWR0aCA9XHJcblx0XHRcdHAuY3Jvc3NCWC5zdHlsZS5oZWlnaHQgPVxyXG5cdFx0XHRcdCgyICogVEhJUy5wb2ludGVyQm9yZGVyV2lkdGggKyBUSElTLnBvaW50ZXJUaGlja25lc3MpICsgJ3B4JztcclxuXHRcdFx0cC5jcm9zc0JZLnN0eWxlLmhlaWdodCA9XHJcblx0XHRcdHAuY3Jvc3NCWC5zdHlsZS53aWR0aCA9XHJcblx0XHRcdFx0Y3Jvc3NPdXRlclNpemUgKyAncHgnO1xyXG5cdFx0XHRwLmNyb3NzQlkuc3R5bGUubGVmdCA9XHJcblx0XHRcdHAuY3Jvc3NCWC5zdHlsZS50b3AgPVxyXG5cdFx0XHRcdChNYXRoLmZsb29yKGNyb3NzT3V0ZXJTaXplIC8gMikgLSBNYXRoLmZsb29yKFRISVMucG9pbnRlclRoaWNrbmVzcyAvIDIpIC0gVEhJUy5wb2ludGVyQm9yZGVyV2lkdGgpICsgJ3B4JztcclxuXHRcdFx0cC5jcm9zc0JZLnN0eWxlLnRvcCA9XHJcblx0XHRcdHAuY3Jvc3NCWC5zdHlsZS5sZWZ0ID1cclxuXHRcdFx0XHQnMCc7XHJcblxyXG5cdFx0XHQvLyBwYWQgY3Jvc3MgbGluZSBZIGFuZCBYXHJcblx0XHRcdHAuY3Jvc3NMWS5zdHlsZS5wb3NpdGlvbiA9XHJcblx0XHRcdHAuY3Jvc3NMWC5zdHlsZS5wb3NpdGlvbiA9XHJcblx0XHRcdFx0J2Fic29sdXRlJztcclxuXHRcdFx0cC5jcm9zc0xZLnN0eWxlLmJhY2tncm91bmQgPVxyXG5cdFx0XHRwLmNyb3NzTFguc3R5bGUuYmFja2dyb3VuZCA9XHJcblx0XHRcdFx0VEhJUy5wb2ludGVyQ29sb3I7XHJcblx0XHRcdHAuY3Jvc3NMWS5zdHlsZS5oZWlnaHQgPVxyXG5cdFx0XHRwLmNyb3NzTFguc3R5bGUud2lkdGggPVxyXG5cdFx0XHRcdChjcm9zc091dGVyU2l6ZSAtIDIgKiBUSElTLnBvaW50ZXJCb3JkZXJXaWR0aCkgKyAncHgnO1xyXG5cdFx0XHRwLmNyb3NzTFkuc3R5bGUud2lkdGggPVxyXG5cdFx0XHRwLmNyb3NzTFguc3R5bGUuaGVpZ2h0ID1cclxuXHRcdFx0XHRUSElTLnBvaW50ZXJUaGlja25lc3MgKyAncHgnO1xyXG5cdFx0XHRwLmNyb3NzTFkuc3R5bGUubGVmdCA9XHJcblx0XHRcdHAuY3Jvc3NMWC5zdHlsZS50b3AgPVxyXG5cdFx0XHRcdChNYXRoLmZsb29yKGNyb3NzT3V0ZXJTaXplIC8gMikgLSBNYXRoLmZsb29yKFRISVMucG9pbnRlclRoaWNrbmVzcyAvIDIpKSArICdweCc7XHJcblx0XHRcdHAuY3Jvc3NMWS5zdHlsZS50b3AgPVxyXG5cdFx0XHRwLmNyb3NzTFguc3R5bGUubGVmdCA9XHJcblx0XHRcdFx0VEhJUy5wb2ludGVyQm9yZGVyV2lkdGggKyAncHgnO1xyXG5cclxuXHRcdFx0Ly8gc2xpZGVyXHJcblx0XHRcdHAuc2xkLnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XHJcblx0XHRcdHAuc2xkLnN0eWxlLndpZHRoID0gVEhJUy5zbGlkZXJTaXplICsgJ3B4JztcclxuXHRcdFx0cC5zbGQuc3R5bGUuaGVpZ2h0ID0gVEhJUy5oZWlnaHQgKyAncHgnO1xyXG5cclxuXHRcdFx0Ly8gc2xpZGVyIGdyYWRpZW50XHJcblx0XHRcdHAuc2xkR3JhZC5kcmF3KFRISVMuc2xpZGVyU2l6ZSwgVEhJUy5oZWlnaHQsICcjMDAwJywgJyMwMDAnKTtcclxuXHJcblx0XHRcdC8vIHNsaWRlciBib3JkZXJcclxuXHRcdFx0cC5zbGRCLnN0eWxlLmRpc3BsYXkgPSBkaXNwbGF5U2xpZGVyID8gJ2Jsb2NrJyA6ICdub25lJztcclxuXHRcdFx0cC5zbGRCLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcclxuXHRcdFx0cC5zbGRCLnN0eWxlLnJpZ2h0ID0gVEhJUy5wYWRkaW5nICsgJ3B4JztcclxuXHRcdFx0cC5zbGRCLnN0eWxlLnRvcCA9IFRISVMucGFkZGluZyArICdweCc7XHJcblx0XHRcdHAuc2xkQi5zdHlsZS5ib3JkZXIgPSBUSElTLmluc2V0V2lkdGggKyAncHggc29saWQnO1xyXG5cdFx0XHRwLnNsZEIuc3R5bGUuYm9yZGVyQ29sb3IgPSBUSElTLmluc2V0Q29sb3I7XHJcblxyXG5cdFx0XHQvLyBzbGlkZXIgbW91c2UgYXJlYVxyXG5cdFx0XHRwLnNsZE0uX2pzY0luc3RhbmNlID0gVEhJUztcclxuXHRcdFx0cC5zbGRNLl9qc2NDb250cm9sTmFtZSA9ICdzbGQnO1xyXG5cdFx0XHRwLnNsZE0uc3R5bGUuZGlzcGxheSA9IGRpc3BsYXlTbGlkZXIgPyAnYmxvY2snIDogJ25vbmUnO1xyXG5cdFx0XHRwLnNsZE0uc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xyXG5cdFx0XHRwLnNsZE0uc3R5bGUucmlnaHQgPSAnMCc7XHJcblx0XHRcdHAuc2xkTS5zdHlsZS50b3AgPSAnMCc7XHJcblx0XHRcdHAuc2xkTS5zdHlsZS53aWR0aCA9IChUSElTLnNsaWRlclNpemUgKyBwYWRUb1NsaWRlclBhZGRpbmcgLyAyICsgVEhJUy5wYWRkaW5nICsgMiAqIFRISVMuaW5zZXRXaWR0aCkgKyAncHgnO1xyXG5cdFx0XHRwLnNsZE0uc3R5bGUuaGVpZ2h0ID0gZGltc1sxXSArICdweCc7XHJcblx0XHRcdHAuc2xkTS5zdHlsZS5jdXJzb3IgPSAnZGVmYXVsdCc7XHJcblxyXG5cdFx0XHQvLyBzbGlkZXIgcG9pbnRlciBpbm5lciBhbmQgb3V0ZXIgYm9yZGVyXHJcblx0XHRcdHAuc2xkUHRySUIuc3R5bGUuYm9yZGVyID1cclxuXHRcdFx0cC5zbGRQdHJPQi5zdHlsZS5ib3JkZXIgPVxyXG5cdFx0XHRcdFRISVMucG9pbnRlckJvcmRlcldpZHRoICsgJ3B4IHNvbGlkICcgKyBUSElTLnBvaW50ZXJCb3JkZXJDb2xvcjtcclxuXHJcblx0XHRcdC8vIHNsaWRlciBwb2ludGVyIG91dGVyIGJvcmRlclxyXG5cdFx0XHRwLnNsZFB0ck9CLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcclxuXHRcdFx0cC5zbGRQdHJPQi5zdHlsZS5sZWZ0ID0gLSgyICogVEhJUy5wb2ludGVyQm9yZGVyV2lkdGggKyBUSElTLnBvaW50ZXJUaGlja25lc3MpICsgJ3B4JztcclxuXHRcdFx0cC5zbGRQdHJPQi5zdHlsZS50b3AgPSAnMCc7XHJcblxyXG5cdFx0XHQvLyBzbGlkZXIgcG9pbnRlciBtaWRkbGUgYm9yZGVyXHJcblx0XHRcdHAuc2xkUHRyTUIuc3R5bGUuYm9yZGVyID0gVEhJUy5wb2ludGVyVGhpY2tuZXNzICsgJ3B4IHNvbGlkICcgKyBUSElTLnBvaW50ZXJDb2xvcjtcclxuXHJcblx0XHRcdC8vIHNsaWRlciBwb2ludGVyIHNwYWNlclxyXG5cdFx0XHRwLnNsZFB0clMuc3R5bGUud2lkdGggPSBUSElTLnNsaWRlclNpemUgKyAncHgnO1xyXG5cdFx0XHRwLnNsZFB0clMuc3R5bGUuaGVpZ2h0ID0gc2xpZGVyUHRyU3BhY2UgKyAncHgnO1xyXG5cclxuXHRcdFx0Ly8gdGhlIENsb3NlIGJ1dHRvblxyXG5cdFx0XHRmdW5jdGlvbiBzZXRCdG5Cb3JkZXIgKCkge1xyXG5cdFx0XHRcdHZhciBpbnNldENvbG9ycyA9IFRISVMuaW5zZXRDb2xvci5zcGxpdCgvXFxzKy8pO1xyXG5cdFx0XHRcdHZhciBvdXRzZXRDb2xvciA9IGluc2V0Q29sb3JzLmxlbmd0aCA8IDIgPyBpbnNldENvbG9yc1swXSA6IGluc2V0Q29sb3JzWzFdICsgJyAnICsgaW5zZXRDb2xvcnNbMF0gKyAnICcgKyBpbnNldENvbG9yc1swXSArICcgJyArIGluc2V0Q29sb3JzWzFdO1xyXG5cdFx0XHRcdHAuYnRuLnN0eWxlLmJvcmRlckNvbG9yID0gb3V0c2V0Q29sb3I7XHJcblx0XHRcdH1cclxuXHRcdFx0cC5idG4uc3R5bGUuZGlzcGxheSA9IFRISVMuY2xvc2FibGUgPyAnYmxvY2snIDogJ25vbmUnO1xyXG5cdFx0XHRwLmJ0bi5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XHJcblx0XHRcdHAuYnRuLnN0eWxlLmxlZnQgPSBUSElTLnBhZGRpbmcgKyAncHgnO1xyXG5cdFx0XHRwLmJ0bi5zdHlsZS5ib3R0b20gPSBUSElTLnBhZGRpbmcgKyAncHgnO1xyXG5cdFx0XHRwLmJ0bi5zdHlsZS5wYWRkaW5nID0gJzAgMTVweCc7XHJcblx0XHRcdHAuYnRuLnN0eWxlLmhlaWdodCA9IFRISVMuYnV0dG9uSGVpZ2h0ICsgJ3B4JztcclxuXHRcdFx0cC5idG4uc3R5bGUuYm9yZGVyID0gVEhJUy5pbnNldFdpZHRoICsgJ3B4IHNvbGlkJztcclxuXHRcdFx0c2V0QnRuQm9yZGVyKCk7XHJcblx0XHRcdHAuYnRuLnN0eWxlLmNvbG9yID0gVEhJUy5idXR0b25Db2xvcjtcclxuXHRcdFx0cC5idG4uc3R5bGUuZm9udCA9ICcxMnB4IHNhbnMtc2VyaWYnO1xyXG5cdFx0XHRwLmJ0bi5zdHlsZS50ZXh0QWxpZ24gPSAnY2VudGVyJztcclxuXHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRwLmJ0bi5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcblx0XHRcdH0gY2F0Y2goZU9sZElFKSB7XHJcblx0XHRcdFx0cC5idG4uc3R5bGUuY3Vyc29yID0gJ2hhbmQnO1xyXG5cdFx0XHR9XHJcblx0XHRcdHAuYnRuLm9ubW91c2Vkb3duID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFRISVMuaGlkZSgpO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHRwLmJ0blQuc3R5bGUubGluZUhlaWdodCA9IFRISVMuYnV0dG9uSGVpZ2h0ICsgJ3B4JztcclxuXHRcdFx0cC5idG5ULmlubmVySFRNTCA9ICcnO1xyXG5cdFx0XHRwLmJ0blQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoVEhJUy5jbG9zZVRleHQpKTtcclxuXHJcblx0XHRcdC8vIHBsYWNlIHBvaW50ZXJzXHJcblx0XHRcdHJlZHJhd1BhZCgpO1xyXG5cdFx0XHRyZWRyYXdTbGQoKTtcclxuXHJcblx0XHRcdC8vIElmIHdlIGFyZSBjaGFuZ2luZyB0aGUgb3duZXIgd2l0aG91dCBmaXJzdCBjbG9zaW5nIHRoZSBwaWNrZXIsXHJcblx0XHRcdC8vIG1ha2Ugc3VyZSB0byBmaXJzdCBkZWFsIHdpdGggdGhlIG9sZCBvd25lclxyXG5cdFx0XHRpZiAoanNjLnBpY2tlci5vd25lciAmJiBqc2MucGlja2VyLm93bmVyICE9PSBUSElTKSB7XHJcblx0XHRcdFx0anNjLnVuc2V0Q2xhc3MoanNjLnBpY2tlci5vd25lci50YXJnZXRFbGVtZW50LCBUSElTLmFjdGl2ZUNsYXNzKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gU2V0IHRoZSBuZXcgcGlja2VyIG93bmVyXHJcblx0XHRcdGpzYy5waWNrZXIub3duZXIgPSBUSElTO1xyXG5cclxuXHRcdFx0Ly8gVGhlIHJlZHJhd1Bvc2l0aW9uKCkgbWV0aG9kIG5lZWRzIHBpY2tlci5vd25lciB0byBiZSBzZXQsIHRoYXQncyB3aHkgd2UgY2FsbCBpdCBoZXJlLFxyXG5cdFx0XHQvLyBhZnRlciBzZXR0aW5nIHRoZSBvd25lclxyXG5cdFx0XHRpZiAoanNjLmlzRWxlbWVudFR5cGUoY29udGFpbmVyLCAnYm9keScpKSB7XHJcblx0XHRcdFx0anNjLnJlZHJhd1Bvc2l0aW9uKCk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0anNjLl9kcmF3UG9zaXRpb24oVEhJUywgMCwgMCwgJ3JlbGF0aXZlJywgZmFsc2UpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRpZiAocC53cmFwLnBhcmVudE5vZGUgIT0gY29udGFpbmVyKSB7XHJcblx0XHRcdFx0Y29udGFpbmVyLmFwcGVuZENoaWxkKHAud3JhcCk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGpzYy5zZXRDbGFzcyhUSElTLnRhcmdldEVsZW1lbnQsIFRISVMuYWN0aXZlQ2xhc3MpO1xyXG5cdFx0fVxyXG5cclxuXHJcblx0XHRmdW5jdGlvbiByZWRyYXdQYWQgKCkge1xyXG5cdFx0XHQvLyByZWRyYXcgdGhlIHBhZCBwb2ludGVyXHJcblx0XHRcdHN3aXRjaCAoanNjLmdldFBhZFlDb21wb25lbnQoVEhJUykpIHtcclxuXHRcdFx0Y2FzZSAncyc6IHZhciB5Q29tcG9uZW50ID0gMTsgYnJlYWs7XHJcblx0XHRcdGNhc2UgJ3YnOiB2YXIgeUNvbXBvbmVudCA9IDI7IGJyZWFrO1xyXG5cdFx0XHR9XHJcblx0XHRcdHZhciB4ID0gTWF0aC5yb3VuZCgoVEhJUy5oc3ZbMF0gLyAzNjApICogKFRISVMud2lkdGggLSAxKSk7XHJcblx0XHRcdHZhciB5ID0gTWF0aC5yb3VuZCgoMSAtIFRISVMuaHN2W3lDb21wb25lbnRdIC8gMTAwKSAqIChUSElTLmhlaWdodCAtIDEpKTtcclxuXHRcdFx0dmFyIGNyb3NzT3V0ZXJTaXplID0gKDIgKiBUSElTLnBvaW50ZXJCb3JkZXJXaWR0aCArIFRISVMucG9pbnRlclRoaWNrbmVzcyArIDIgKiBUSElTLmNyb3NzU2l6ZSk7XHJcblx0XHRcdHZhciBvZnMgPSAtTWF0aC5mbG9vcihjcm9zc091dGVyU2l6ZSAvIDIpO1xyXG5cdFx0XHRqc2MucGlja2VyLmNyb3NzLnN0eWxlLmxlZnQgPSAoeCArIG9mcykgKyAncHgnO1xyXG5cdFx0XHRqc2MucGlja2VyLmNyb3NzLnN0eWxlLnRvcCA9ICh5ICsgb2ZzKSArICdweCc7XHJcblxyXG5cdFx0XHQvLyByZWRyYXcgdGhlIHNsaWRlclxyXG5cdFx0XHRzd2l0Y2ggKGpzYy5nZXRTbGlkZXJDb21wb25lbnQoVEhJUykpIHtcclxuXHRcdFx0Y2FzZSAncyc6XHJcblx0XHRcdFx0dmFyIHJnYjEgPSBIU1ZfUkdCKFRISVMuaHN2WzBdLCAxMDAsIFRISVMuaHN2WzJdKTtcclxuXHRcdFx0XHR2YXIgcmdiMiA9IEhTVl9SR0IoVEhJUy5oc3ZbMF0sIDAsIFRISVMuaHN2WzJdKTtcclxuXHRcdFx0XHR2YXIgY29sb3IxID0gJ3JnYignICtcclxuXHRcdFx0XHRcdE1hdGgucm91bmQocmdiMVswXSkgKyAnLCcgK1xyXG5cdFx0XHRcdFx0TWF0aC5yb3VuZChyZ2IxWzFdKSArICcsJyArXHJcblx0XHRcdFx0XHRNYXRoLnJvdW5kKHJnYjFbMl0pICsgJyknO1xyXG5cdFx0XHRcdHZhciBjb2xvcjIgPSAncmdiKCcgK1xyXG5cdFx0XHRcdFx0TWF0aC5yb3VuZChyZ2IyWzBdKSArICcsJyArXHJcblx0XHRcdFx0XHRNYXRoLnJvdW5kKHJnYjJbMV0pICsgJywnICtcclxuXHRcdFx0XHRcdE1hdGgucm91bmQocmdiMlsyXSkgKyAnKSc7XHJcblx0XHRcdFx0anNjLnBpY2tlci5zbGRHcmFkLmRyYXcoVEhJUy5zbGlkZXJTaXplLCBUSElTLmhlaWdodCwgY29sb3IxLCBjb2xvcjIpO1xyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRjYXNlICd2JzpcclxuXHRcdFx0XHR2YXIgcmdiID0gSFNWX1JHQihUSElTLmhzdlswXSwgVEhJUy5oc3ZbMV0sIDEwMCk7XHJcblx0XHRcdFx0dmFyIGNvbG9yMSA9ICdyZ2IoJyArXHJcblx0XHRcdFx0XHRNYXRoLnJvdW5kKHJnYlswXSkgKyAnLCcgK1xyXG5cdFx0XHRcdFx0TWF0aC5yb3VuZChyZ2JbMV0pICsgJywnICtcclxuXHRcdFx0XHRcdE1hdGgucm91bmQocmdiWzJdKSArICcpJztcclxuXHRcdFx0XHR2YXIgY29sb3IyID0gJyMwMDAnO1xyXG5cdFx0XHRcdGpzYy5waWNrZXIuc2xkR3JhZC5kcmF3KFRISVMuc2xpZGVyU2l6ZSwgVEhJUy5oZWlnaHQsIGNvbG9yMSwgY29sb3IyKTtcclxuXHRcdFx0XHRicmVhaztcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHJcblx0XHRmdW5jdGlvbiByZWRyYXdTbGQgKCkge1xyXG5cdFx0XHR2YXIgc2xkQ29tcG9uZW50ID0ganNjLmdldFNsaWRlckNvbXBvbmVudChUSElTKTtcclxuXHRcdFx0aWYgKHNsZENvbXBvbmVudCkge1xyXG5cdFx0XHRcdC8vIHJlZHJhdyB0aGUgc2xpZGVyIHBvaW50ZXJcclxuXHRcdFx0XHRzd2l0Y2ggKHNsZENvbXBvbmVudCkge1xyXG5cdFx0XHRcdGNhc2UgJ3MnOiB2YXIgeUNvbXBvbmVudCA9IDE7IGJyZWFrO1xyXG5cdFx0XHRcdGNhc2UgJ3YnOiB2YXIgeUNvbXBvbmVudCA9IDI7IGJyZWFrO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHR2YXIgeSA9IE1hdGgucm91bmQoKDEgLSBUSElTLmhzdlt5Q29tcG9uZW50XSAvIDEwMCkgKiAoVEhJUy5oZWlnaHQgLSAxKSk7XHJcblx0XHRcdFx0anNjLnBpY2tlci5zbGRQdHJPQi5zdHlsZS50b3AgPSAoeSAtICgyICogVEhJUy5wb2ludGVyQm9yZGVyV2lkdGggKyBUSElTLnBvaW50ZXJUaGlja25lc3MpIC0gTWF0aC5mbG9vcihzbGlkZXJQdHJTcGFjZSAvIDIpKSArICdweCc7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblxyXG5cdFx0ZnVuY3Rpb24gaXNQaWNrZXJPd25lciAoKSB7XHJcblx0XHRcdHJldHVybiBqc2MucGlja2VyICYmIGpzYy5waWNrZXIub3duZXIgPT09IFRISVM7XHJcblx0XHR9XHJcblxyXG5cclxuXHRcdGZ1bmN0aW9uIGJsdXJWYWx1ZSAoKSB7XHJcblx0XHRcdFRISVMuaW1wb3J0Q29sb3IoKTtcclxuXHRcdH1cclxuXHJcblxyXG5cdFx0Ly8gRmluZCB0aGUgdGFyZ2V0IGVsZW1lbnRcclxuXHRcdGlmICh0eXBlb2YgdGFyZ2V0RWxlbWVudCA9PT0gJ3N0cmluZycpIHtcclxuXHRcdFx0dmFyIGlkID0gdGFyZ2V0RWxlbWVudDtcclxuXHRcdFx0dmFyIGVsbSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcclxuXHRcdFx0aWYgKGVsbSkge1xyXG5cdFx0XHRcdHRoaXMudGFyZ2V0RWxlbWVudCA9IGVsbTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRqc2Mud2FybignQ291bGQgbm90IGZpbmQgdGFyZ2V0IGVsZW1lbnQgd2l0aCBJRCBcXCcnICsgaWQgKyAnXFwnJyk7XHJcblx0XHRcdH1cclxuXHRcdH0gZWxzZSBpZiAodGFyZ2V0RWxlbWVudCkge1xyXG5cdFx0XHR0aGlzLnRhcmdldEVsZW1lbnQgPSB0YXJnZXRFbGVtZW50O1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0anNjLndhcm4oJ0ludmFsaWQgdGFyZ2V0IGVsZW1lbnQ6IFxcJycgKyB0YXJnZXRFbGVtZW50ICsgJ1xcJycpO1xyXG5cdFx0fVxyXG5cclxuXHRcdGlmICh0aGlzLnRhcmdldEVsZW1lbnQuX2pzY0xpbmtlZEluc3RhbmNlKSB7XHJcblx0XHRcdGpzYy53YXJuKCdDYW5ub3QgbGluayBqc2NvbG9yIHR3aWNlIHRvIHRoZSBzYW1lIGVsZW1lbnQuIFNraXBwaW5nLicpO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblx0XHR0aGlzLnRhcmdldEVsZW1lbnQuX2pzY0xpbmtlZEluc3RhbmNlID0gdGhpcztcclxuXHJcblx0XHQvLyBGaW5kIHRoZSB2YWx1ZSBlbGVtZW50XHJcblx0XHR0aGlzLnZhbHVlRWxlbWVudCA9IGpzYy5mZXRjaEVsZW1lbnQodGhpcy52YWx1ZUVsZW1lbnQpO1xyXG5cdFx0Ly8gRmluZCB0aGUgc3R5bGUgZWxlbWVudFxyXG5cdFx0dGhpcy5zdHlsZUVsZW1lbnQgPSBqc2MuZmV0Y2hFbGVtZW50KHRoaXMuc3R5bGVFbGVtZW50KTtcclxuXHJcblx0XHR2YXIgVEhJUyA9IHRoaXM7XHJcblx0XHR2YXIgY29udGFpbmVyID1cclxuXHRcdFx0dGhpcy5jb250YWluZXIgP1xyXG5cdFx0XHRqc2MuZmV0Y2hFbGVtZW50KHRoaXMuY29udGFpbmVyKSA6XHJcblx0XHRcdGRvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdib2R5JylbMF07XHJcblx0XHR2YXIgc2xpZGVyUHRyU3BhY2UgPSAzOyAvLyBweFxyXG5cclxuXHRcdC8vIEZvciBCVVRUT04gZWxlbWVudHMgaXQncyBpbXBvcnRhbnQgdG8gc3RvcCB0aGVtIGZyb20gc2VuZGluZyB0aGUgZm9ybSB3aGVuIGNsaWNrZWRcclxuXHRcdC8vIChlLmcuIGluIFNhZmFyaSlcclxuXHRcdGlmIChqc2MuaXNFbGVtZW50VHlwZSh0aGlzLnRhcmdldEVsZW1lbnQsICdidXR0b24nKSkge1xyXG5cdFx0XHRpZiAodGhpcy50YXJnZXRFbGVtZW50Lm9uY2xpY2spIHtcclxuXHRcdFx0XHR2YXIgb3JpZ0NhbGxiYWNrID0gdGhpcy50YXJnZXRFbGVtZW50Lm9uY2xpY2s7XHJcblx0XHRcdFx0dGhpcy50YXJnZXRFbGVtZW50Lm9uY2xpY2sgPSBmdW5jdGlvbiAoZXZ0KSB7XHJcblx0XHRcdFx0XHRvcmlnQ2FsbGJhY2suY2FsbCh0aGlzLCBldnQpO1xyXG5cdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0XHRcdH07XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGhpcy50YXJnZXRFbGVtZW50Lm9uY2xpY2sgPSBmdW5jdGlvbiAoKSB7IHJldHVybiBmYWxzZTsgfTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdC8qXHJcblx0XHR2YXIgZWxtID0gdGhpcy50YXJnZXRFbGVtZW50O1xyXG5cdFx0ZG8ge1xyXG5cdFx0XHQvLyBJZiB0aGUgdGFyZ2V0IGVsZW1lbnQgb3Igb25lIG9mIGl0cyBvZmZzZXRQYXJlbnRzIGhhcyBmaXhlZCBwb3NpdGlvbixcclxuXHRcdFx0Ly8gdGhlbiB1c2UgZml4ZWQgcG9zaXRpb25pbmcgaW5zdGVhZFxyXG5cdFx0XHQvL1xyXG5cdFx0XHQvLyBOb3RlOiBJbiBGaXJlZm94LCBnZXRDb21wdXRlZFN0eWxlIHJldHVybnMgbnVsbCBpbiBhIGhpZGRlbiBpZnJhbWUsXHJcblx0XHRcdC8vIHRoYXQncyB3aHkgd2UgbmVlZCB0byBjaGVjayBpZiB0aGUgcmV0dXJuZWQgc3R5bGUgb2JqZWN0IGlzIG5vbi1lbXB0eVxyXG5cdFx0XHR2YXIgY3VyclN0eWxlID0ganNjLmdldFN0eWxlKGVsbSk7XHJcblx0XHRcdGlmIChjdXJyU3R5bGUgJiYgY3VyclN0eWxlLnBvc2l0aW9uLnRvTG93ZXJDYXNlKCkgPT09ICdmaXhlZCcpIHtcclxuXHRcdFx0XHR0aGlzLmZpeGVkID0gdHJ1ZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0aWYgKGVsbSAhPT0gdGhpcy50YXJnZXRFbGVtZW50KSB7XHJcblx0XHRcdFx0Ly8gYXR0YWNoIG9uUGFyZW50U2Nyb2xsIHNvIHRoYXQgd2UgY2FuIHJlY29tcHV0ZSB0aGUgcGlja2VyIHBvc2l0aW9uXHJcblx0XHRcdFx0Ly8gd2hlbiBvbmUgb2YgdGhlIG9mZnNldFBhcmVudHMgaXMgc2Nyb2xsZWRcclxuXHRcdFx0XHRpZiAoIWVsbS5fanNjRXZlbnRzQXR0YWNoZWQpIHtcclxuXHRcdFx0XHRcdGpzYy5hdHRhY2hFdmVudChlbG0sICdzY3JvbGwnLCBqc2Mub25QYXJlbnRTY3JvbGwpO1xyXG5cdFx0XHRcdFx0ZWxtLl9qc2NFdmVudHNBdHRhY2hlZCA9IHRydWU7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9IHdoaWxlICgoZWxtID0gZWxtLm9mZnNldFBhcmVudCkgJiYgIWpzYy5pc0VsZW1lbnRUeXBlKGVsbSwgJ2JvZHknKSk7XHJcblx0XHQqL1xyXG5cclxuXHRcdC8vIHZhbHVlRWxlbWVudFxyXG5cdFx0aWYgKHRoaXMudmFsdWVFbGVtZW50KSB7XHJcblx0XHRcdGlmIChqc2MuaXNFbGVtZW50VHlwZSh0aGlzLnZhbHVlRWxlbWVudCwgJ2lucHV0JykpIHtcclxuXHRcdFx0XHR2YXIgdXBkYXRlRmllbGQgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdFx0XHRUSElTLmZyb21TdHJpbmcoVEhJUy52YWx1ZUVsZW1lbnQudmFsdWUsIGpzYy5sZWF2ZVZhbHVlKTtcclxuXHRcdFx0XHRcdGpzYy5kaXNwYXRjaEZpbmVDaGFuZ2UoVEhJUyk7XHJcblx0XHRcdFx0fTtcclxuXHRcdFx0XHRqc2MuYXR0YWNoRXZlbnQodGhpcy52YWx1ZUVsZW1lbnQsICdrZXl1cCcsIHVwZGF0ZUZpZWxkKTtcclxuXHRcdFx0XHRqc2MuYXR0YWNoRXZlbnQodGhpcy52YWx1ZUVsZW1lbnQsICdpbnB1dCcsIHVwZGF0ZUZpZWxkKTtcclxuXHRcdFx0XHRqc2MuYXR0YWNoRXZlbnQodGhpcy52YWx1ZUVsZW1lbnQsICdibHVyJywgYmx1clZhbHVlKTtcclxuXHRcdFx0XHR0aGlzLnZhbHVlRWxlbWVudC5zZXRBdHRyaWJ1dGUoJ2F1dG9jb21wbGV0ZScsICdvZmYnKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdC8vIHN0eWxlRWxlbWVudFxyXG5cdFx0aWYgKHRoaXMuc3R5bGVFbGVtZW50KSB7XHJcblx0XHRcdHRoaXMuc3R5bGVFbGVtZW50Ll9qc2NPcmlnU3R5bGUgPSB7XHJcblx0XHRcdFx0YmFja2dyb3VuZEltYWdlIDogdGhpcy5zdHlsZUVsZW1lbnQuc3R5bGUuYmFja2dyb3VuZEltYWdlLFxyXG5cdFx0XHRcdGJhY2tncm91bmRDb2xvciA6IHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmJhY2tncm91bmRDb2xvcixcclxuXHRcdFx0XHRjb2xvciA6IHRoaXMuc3R5bGVFbGVtZW50LnN0eWxlLmNvbG9yXHJcblx0XHRcdH07XHJcblx0XHR9XHJcblxyXG5cdFx0aWYgKHRoaXMudmFsdWUpIHtcclxuXHRcdFx0Ly8gVHJ5IHRvIHNldCB0aGUgY29sb3IgZnJvbSB0aGUgLnZhbHVlIG9wdGlvbiBhbmQgaWYgdW5zdWNjZXNzZnVsLFxyXG5cdFx0XHQvLyBleHBvcnQgdGhlIGN1cnJlbnQgY29sb3JcclxuXHRcdFx0dGhpcy5mcm9tU3RyaW5nKHRoaXMudmFsdWUpIHx8IHRoaXMuZXhwb3J0Q29sb3IoKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdHRoaXMuaW1wb3J0Q29sb3IoKTtcclxuXHRcdH1cclxuXHR9XHJcblxyXG59O1xyXG5cclxuXHJcbi8vPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUHVibGljIHByb3BlcnRpZXMgYW5kIG1ldGhvZHNcclxuLy89PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuXHJcbi8vIEJ5IGRlZmF1bHQsIHNlYXJjaCBmb3IgYWxsIGVsZW1lbnRzIHdpdGggY2xhc3M9XCJqc2NvbG9yXCIgYW5kIGluc3RhbGwgYSBjb2xvciBwaWNrZXIgb24gdGhlbS5cclxuLy9cclxuLy8gWW91IGNhbiBjaGFuZ2Ugd2hhdCBjbGFzcyBuYW1lIHdpbGwgYmUgbG9va2VkIGZvciBieSBzZXR0aW5nIHRoZSBwcm9wZXJ0eSBqc2NvbG9yLmxvb2t1cENsYXNzXHJcbi8vIGFueXdoZXJlIGluIHlvdXIgSFRNTCBkb2N1bWVudC4gVG8gY29tcGxldGVseSBkaXNhYmxlIHRoZSBhdXRvbWF0aWMgbG9va3VwLCBzZXQgaXQgdG8gbnVsbC5cclxuLy9cclxuanNjLmpzY29sb3IubG9va3VwQ2xhc3MgPSAnanNjb2xvcic7XHJcblxyXG5cclxuanNjLmpzY29sb3IuaW5zdGFsbEJ5Q2xhc3NOYW1lID0gZnVuY3Rpb24oY2xhc3NOYW1lKSB7XHJcblx0dmFyIGlucHV0RWxtcyA9IGRvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdpbnB1dCcpO1xyXG5cdHZhciBidXR0b25FbG1zID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2J1dHRvbicpO1xyXG5cclxuXHRqc2MudHJ5SW5zdGFsbE9uRWxlbWVudHMoaW5wdXRFbG1zLCBjbGFzc05hbWUpO1xyXG5cdGpzYy50cnlJbnN0YWxsT25FbGVtZW50cyhidXR0b25FbG1zLCBjbGFzc05hbWUpO1xyXG59O1xyXG5cclxuXHJcbmpzYy5yZWdpc3RlcigpO1xyXG5cclxuXHJcbnJldHVybiBqc2M7XHJcblxyXG5cclxufSk7XHJcblxuIiwiZGVmaW5lKCdjb2xvclN0b3AnLFsnanNjb2xvciddLCBmdW5jdGlvbihqc2MpIHtcblxuXHR2YXIganNjb2xvciA9IGpzYy5qc2NvbG9yO1xuXG5cdGZ1bmN0aW9uIENvbG9yU3RvcChncmFkaWVudCwgcG9zaXRpb24sIGNvbG9yLCBzaXplKSB7XG5cblx0XHR0aGlzLmdyYWRpZW50ID0gZ3JhZGllbnQ7XG5cdFx0dGhpcy5wb3NpdGlvbiA9IHBvc2l0aW9uO1xuXHRcdHRoaXMuY29sb3IgPSBjb2xvcjtcblx0XHRcblx0XHR0aGlzLnNpemUgPSBzaXplO1xuXG5cdFx0dGhpcy53aWR0aCA9IHRoaXMuZ3JhZGllbnQuZG9tRWxlbWVudC5jbGllbnRIZWlnaHQvKDEwLXRoaXMuc2l6ZSk7XG5cdFx0dGhpcy5oZWlnaHQgPSB0aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuY2xpZW50SGVpZ2h0ICsgdGhpcy5ncmFkaWVudC5kb21FbGVtZW50LmNsaWVudEhlaWdodCowLjU7XG5cblx0XHR0aGlzLmFkZERvbUVsZW1lbnQoKTtcblxuXHR9XG5cblx0Q29sb3JTdG9wLnByb3RvdHlwZS5hZGREb21FbGVtZW50ID0gZnVuY3Rpb24oKSB7XG5cblx0XHR2YXIgX3RoaXMgPSB0aGlzO1xuXG5cdFx0dmFyIHggPSB0aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuY2xpZW50V2lkdGggKiB0aGlzLnBvc2l0aW9uO1xuXHRcdGlmICh4IDwgMCkgeCA9IDA7XG5cdFx0aWYgKHggPiB0aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuY2xpZW50V2lkdGgtdGhpcy53aWR0aCkgeCA9IHRoaXMuZ3JhZGllbnQuZG9tRWxlbWVudC5jbGllbnRXaWR0aCAtIHRoaXMud2lkdGg7XG5cblx0XHR0aGlzLnNxdWFyZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuXHRcdHRoaXMuc3F1YXJlLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcblx0XHR0aGlzLnNxdWFyZS5zdHlsZS5sZWZ0ID0geCArICdweCc7IFxuXHRcdHRoaXMuc3F1YXJlLnN0eWxlLmJvdHRvbSA9IC0xIC0gdGhpcy5ncmFkaWVudC5kb21FbGVtZW50LmNsaWVudEhlaWdodCowLjI1ICsgJ3B4Jztcblx0XHR0aGlzLnNxdWFyZS5zdHlsZS53aWR0aCA9IHRoaXMud2lkdGggKyAncHgnO1xuXHRcdHRoaXMuc3F1YXJlLnN0eWxlLmhlaWdodCA9IHRoaXMuaGVpZ2h0ICsgJ3B4Jztcblx0XHR0aGlzLnNxdWFyZS5zdHlsZS5ib3JkZXJSYWRpdXMgPSAyMCArICdweCc7XG5cdFx0dGhpcy5zcXVhcmUuc3R5bGUuYmFja2dyb3VuZCA9IHRoaXMuY29sb3JUb1N0cmluZygpO1xuXHRcdHRoaXMuc3F1YXJlLnN0eWxlLmJvcmRlciA9ICcxcHggc29saWQgIzExMSc7XG5cdFx0dGhpcy5zcXVhcmUuc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuXG5cdFx0dGhpcy5jcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG5cdFx0dGhpcy5jcC5jbGFzc05hbWUgPSAnanNjb2xvcic7XG5cdFx0dGhpcy5jcC52YWx1ZSA9IHRoaXMuY29sb3JUb1N0cmluZygpXG5cdFx0dGhpcy5jcC5zdHlsZS53aWR0aCA9IDA7XG5cdFx0dGhpcy5jcC5zdHlsZS5oZWlnaHQgPSAwO1xuXHRcdHRoaXMuY3Auc3R5bGUubWFyZ2luID0gMDtcblx0XHR0aGlzLmNwLnN0eWxlLnBhZGRpbmcgPSAwO1xuXHRcdHRoaXMuY3Auc3R5bGUuYm9yZGVyID0gJ05vbmUnO1xuXG5cdFx0dGhpcy5zcXVhcmUub25kYmxjbGljayA9IGZ1bmN0aW9uKGV2dCkge1xuXHRcdCBcdHRoaXMuY2hpbGRyZW5bMF0uanNjb2xvci5zaG93KCk7XG5cdFx0IFx0dGhpcy5jaGlsZHJlblswXS5qc2NvbG9yLm9uRmluZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuXHRcdCBcdFx0X3RoaXMuY29sb3IgPSBbTWF0aC5yb3VuZCh0aGlzLnJnYlswXSksIE1hdGgucm91bmQodGhpcy5yZ2JbMV0pLCBNYXRoLnJvdW5kKHRoaXMucmdiWzJdKSwgMV07XG5cdFx0IFx0XHRfdGhpcy5zcXVhcmUuc3R5bGUuYmFja2dyb3VuZCA9IF90aGlzLmNvbG9yVG9TdHJpbmcoKTtcblx0XHQgXHRcdF90aGlzLmdyYWRpZW50LmNhbGN1bGF0ZUdyYWRpZW50KCk7XG5cdFx0IFx0fTtcblx0XHR9O1xuXHRcdHRoaXMuc3F1YXJlLm9ubW91c2VvdmVyID0gZnVuY3Rpb24oZXZ0KSB7XG5cdFx0XHRfdGhpcy5ob3ZlciA9IHRydWU7XG5cdFx0XHRfdGhpcy5ncmFkaWVudC5ob3ZlciA9IHRydWU7XG5cdFx0fTtcblx0XHR0aGlzLnNxdWFyZS5vbm1vdXNlZG93biA9IGZ1bmN0aW9uKGV2dCkge1xuXHRcdFx0X3RoaXMuZHJhZyA9IHRydWU7XG5cdFx0fTtcblx0XHR0aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgZnVuY3Rpb24oZXZ0KSB7XG5cdFx0XHRpZiAoX3RoaXMuZHJhZykge1xuXHRcdFx0XHR2YXIgeCA9IGV2dC5jbGllbnRYIC0gX3RoaXMuZ3JhZGllbnQuZG9tRWxlbWVudC5vZmZzZXRMZWZ0IC0gX3RoaXMud2lkdGgvMlxuXHRcdFx0XHRpZiAoeCA8IDApIHggPSAwO1xuXHRcdFx0XHRpZiAoeCA+IF90aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuY2xpZW50V2lkdGgtX3RoaXMud2lkdGgpIHggPSBfdGhpcy5ncmFkaWVudC5kb21FbGVtZW50LmNsaWVudFdpZHRoIC0gX3RoaXMud2lkdGg7XG5cdFx0XHRcdF90aGlzLnNxdWFyZS5zdHlsZS5sZWZ0ID0geCArJ3B4Jztcblx0XHRcdFx0X3RoaXMucG9zaXRpb24gPSB4L190aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuY2xpZW50V2lkdGg7XG5cdFx0XHRcdF90aGlzLmdyYWRpZW50LmNhbGN1bGF0ZUdyYWRpZW50KCk7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdFx0d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCBmdW5jdGlvbihldnQpIHtcblx0XHRcdF90aGlzLmRyYWcgPSBmYWxzZTtcblx0XHR9KTtcblx0XHR0aGlzLnNxdWFyZS5vbm1vdXNlb3V0ID0gZnVuY3Rpb24oZXZ0KSB7XG5cdFx0XHRfdGhpcy5ob3ZlciA9IGZhbHNlO1xuXHRcdFx0X3RoaXMuZ3JhZGllbnQuaG92ZXIgPSBmYWxzZTtcblx0XHR9O1xuXG5cdFx0dGhpcy5zcXVhcmUuYXBwZW5kKHRoaXMuY3ApO1xuXHRcdC8vIHRoaXMuc3F1YXJlLmFwcGVuZCh0aGlzLnRyaWFuZ2xlKTtcblx0XHR0aGlzLmdyYWRpZW50LmRvbUVsZW1lbnQuYXBwZW5kKHRoaXMuc3F1YXJlKTtcblxuXHRcdGpzYy5yZWdpc3RlcigpXG5cdH07XG5cdENvbG9yU3RvcC5wcm90b3R5cGUuY29sb3JUb1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuXHRcdHJldHVybiAncmdiYSgnK3RoaXMuY29sb3JbMF0rJywgJyt0aGlzLmNvbG9yWzFdKycsICcrdGhpcy5jb2xvclsyXSsnLCAnK3RoaXMuY29sb3JbM10rJyknO1xuXHR9O1xuXG5cdHJldHVybiBDb2xvclN0b3A7XG5cbn0pO1xuIiwiZGVmaW5lKCdHcmFkaWVudCcsWydjb2xvclN0b3AnXSwgZnVuY3Rpb24oQ29sb3JTdG9wKSB7XG5cblx0ZnVuY3Rpb24gR3JhZGllbnQoZG9tRWxlbWVudCwgc2l6ZSkge1xuXG5cdFx0dmFyIF90aGlzID0gdGhpc1xuXG5cdFx0dGhpcy5kb21FbGVtZW50ID0gZG9tRWxlbWVudDtcblxuXHRcdHRoaXMuY29sb3JTdG9wcyA9IFtdO1xuXG5cdFx0dGhpcy5jb2xvclN0b3BTaXplID0gc2l6ZTtcblxuXHRcdHRoaXMuY3JlYXRlSW5pdGlhbENvbG9yU3RvcHMoKTtcblx0XHR0aGlzLmNhbGN1bGF0ZUdyYWRpZW50KCk7XG5cblx0XHR0aGlzLmRvbUVsZW1lbnQub25jbGljayA9IGZ1bmN0aW9uKGV2dCkge1xuXHRcdFx0aWYgKCFfdGhpcy5ob3Zlcikge1xuXHRcdFx0XHR2YXIgeCA9IChldnQuY2xpZW50WCAtIHRoaXMub2Zmc2V0TGVmdCkgLyB0aGlzLmNsaWVudFdpZHRoO1xuXHRcdFx0XHRfdGhpcy5hZGRDb2xvclN0b3AoeCwgX3RoaXMuZ2V0Q29sb3IoeCkpXG5cdFx0XHR9XG5cdFx0fVxuXHRcdHRoaXMuZG9tRWxlbWVudC5vbmNvbnRleHRtZW51ID0gZnVuY3Rpb24oZXZ0KSB7XG5cdFx0XHRpZiAoX3RoaXMuaG92ZXIpIHtcblx0XHRcdFx0dmFyIGNzO1xuXHRcdFx0XHRmb3IgKHZhciBpID0gMDsgaSA8IF90aGlzLmNvbG9yU3RvcHMubGVuZ3RoOyBpKyspIHtcblx0XHRcdFx0XHRjcyA9IF90aGlzLmNvbG9yU3RvcHNbaV07XG5cdFx0XHRcdFx0aWYgKGNzLmhvdmVyKSB7XG5cdFx0XHRcdFx0XHRicmVha1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAoX3RoaXMuY29sb3JTdG9wcy5sZW5ndGggPiAxKSB7XG5cdFx0XHRcdFx0X3RoaXMucmVtb3ZlQ29sb3JTdG9wKGV2dC50b0VsZW1lbnQsIGNzKVxuXHRcdFx0XHRcdF90aGlzLmhvdmVyID0gZmFsc2U7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cblx0fVxuXG5cdEdyYWRpZW50LnByb3RvdHlwZS5jcmVhdGVJbml0aWFsQ29sb3JTdG9wcyA9IGZ1bmN0aW9uKCkge1xuXHRcdFxuXHRcdHRoaXMuYWRkQ29sb3JTdG9wKDAsIFsyNTUsIDAsIDAsIDFdKTtcblx0XHR0aGlzLmFkZENvbG9yU3RvcCgxLCBbMTI4LCAwLCAwLCAxXSk7XG5cblx0fTtcblx0R3JhZGllbnQucHJvdG90eXBlLmFkZENvbG9yU3RvcCA9IGZ1bmN0aW9uKHBvc2l0aW9uLCBjb2xvcikge1xuXHRcdHZhciBuZXdDUyA9IG5ldyBDb2xvclN0b3AodGhpcywgcG9zaXRpb24sIGNvbG9yLCB0aGlzLmNvbG9yU3RvcFNpemUpO1xuXG5cdFx0dGhpcy5jb2xvclN0b3BzLnB1c2gobmV3Q1MpO1xuXG5cdH07XG5cdEdyYWRpZW50LnByb3RvdHlwZS5yZW1vdmVDb2xvclN0b3AgPSBmdW5jdGlvbihkaXYsIGNzKSB7XG5cdFx0dGhpcy5kb21FbGVtZW50LnJlbW92ZUNoaWxkKGRpdik7XG5cblx0XHR2YXIgaSA9IHRoaXMuY29sb3JTdG9wcy5pbmRleE9mKGNzKTtcblx0XHR0aGlzLmNvbG9yU3RvcHMuc3BsaWNlKGksIDEpO1xuXG5cdFx0dGhpcy5jYWxjdWxhdGVHcmFkaWVudCgpXG5cdH07XG5cdEdyYWRpZW50LnByb3RvdHlwZS5jYWxjdWxhdGVHcmFkaWVudCA9IGZ1bmN0aW9uKCkge1xuXHRcdFxuXHRcdHRoaXMuY29sb3JTdG9wcy5zb3J0KGZ1bmN0aW9uKGEsYil7XG5cdFx0XHRyZXR1cm4gYS5wb3NpdGlvbiAtIGIucG9zaXRpb247XG5cdFx0fSk7XG5cdFx0XG5cdFx0dmFyIHN0ciA9ICcnO1xuXHRcdHZhciBqO1xuXHRcdGZvciAoaiA9IDA7IGogPCB0aGlzLmNvbG9yU3RvcHMubGVuZ3RoOyBqKyspIHtcblx0XHRcdHZhciBjID0gdGhpcy5jb2xvclN0b3BzW2pdO1xuXHRcdFx0c3RyICs9ICcsICcgKyBjLmNvbG9yVG9TdHJpbmcoKSArICcgJyArIE1hdGgucm91bmQoYy5wb3NpdGlvbioxMDAwMCkvMTAwICsgJyUnO1xuXHRcdH1cblx0XHRpZiAoaiA+IDEpIHtcblx0XHRcdHRoaXMuZG9tRWxlbWVudC5zdHlsZS5iYWNrZ3JvdW5kID0gJ2xpbmVhci1ncmFkaWVudCh0byByaWdodCcgKyBzdHIgKyAnKSc7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHN0ciA9IHRoaXMuY29sb3JTdG9wc1swXS5jb2xvclRvU3RyaW5nKCk7XG5cdFx0XHR0aGlzLmRvbUVsZW1lbnQuc3R5bGUuYmFja2dyb3VuZCA9IHN0cjtcblx0XHR9XG5cblx0fTtcblx0R3JhZGllbnQucHJvdG90eXBlLmdldENvbG9yID0gZnVuY3Rpb24ocG9zaXRpb24pIHtcblx0XHRpZiAodGhpcy5jb2xvclN0b3BzLmxlbmd0aCA+IDEpIHtcblx0XHRcdGZvciAodmFyIGkgPSAxOyBpIDwgdGhpcy5jb2xvclN0b3BzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdHZhciBrID0gdGhpcy5jb2xvclN0b3BzW2ldO1xuXHRcdFx0XHRpZiAocG9zaXRpb24gPD0gay5wb3NpdGlvbiAmJiBwb3NpdGlvbiA+PSB0aGlzLmNvbG9yU3RvcHNbaS0xXS5wb3NpdGlvbikge1xuXHRcdFx0XHRcdHZhciBwZXJjZW50ID0gcG9zaXRpb24gKiAoMS9rLnBvc2l0aW9uKTtcblx0XHRcdFx0XHRyZXR1cm4gdGhpcy5nZXRDb2xvckZvcm11bGEoay5jb2xvciwgdGhpcy5jb2xvclN0b3BzW2ktMV0uY29sb3IsIHBlcmNlbnQpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRpZiAocG9zaXRpb24gPCB0aGlzLmNvbG9yU3RvcHNbMF0ucG9zaXRpb24pIHtcblx0XHRcdFx0cmV0dXJuIHRoaXMuY29sb3JTdG9wc1swXS5jb2xvcjtcblx0XHRcdH1cblx0XHRcdGlmIChwb3NpdGlvbiA+IHRoaXMuY29sb3JTdG9wc1t0aGlzLmNvbG9yU3RvcHMubGVuZ3RoLTFdLnBvc2l0aW9uKSB7XG5cdFx0XHRcdHJldHVybiB0aGlzLmNvbG9yU3RvcHNbdGhpcy5jb2xvclN0b3BzLmxlbmd0aC0xXS5jb2xvcjtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuIHRoaXMuY29sb3JTdG9wc1swXS5jb2xvcjtcblx0XHR9XG5cdH07XG5cdEdyYWRpZW50LnByb3RvdHlwZS5nZXRDb2xvckZvcm11bGEgPSBmdW5jdGlvbihjb2xvcjEsIGNvbG9yMiwgd2VpZ2h0KSB7XG5cdFx0XG5cdFx0dmFyIHAgPSB3ZWlnaHQ7XG5cdCAgICB2YXIgdyA9IHAgKiAyIC0gMTtcblx0ICAgIHZhciB3MSA9ICh3LzErMSkgLyAyO1xuXHQgICAgdmFyIHcyID0gMSAtIHcxO1xuXHQgICAgdmFyIGNvbG9yID0gW1xuXHQgICAgXHRcdE1hdGgucm91bmQoY29sb3IxWzBdICogdzEgKyBjb2xvcjJbMF0gKiB3MiksXG5cdCAgICAgIFx0XHRNYXRoLnJvdW5kKGNvbG9yMVsxXSAqIHcxICsgY29sb3IyWzFdICogdzIpLFxuXHQgICAgICAgXHRcdE1hdGgucm91bmQoY29sb3IxWzJdICogdzEgKyBjb2xvcjJbMl0gKiB3MiksXG5cdCAgICAgICBcdFx0MVxuXHQgICAgICAgXHRdO1xuXG5cdCAgICByZXR1cm4gY29sb3I7XG5cblx0fTtcblxuXHRyZXR1cm4gR3JhZGllbnQ7XG5cbn0pIDtcbiIsImRlZmluZSgnbWFpbicsWydHcmFkaWVudCddLCBmdW5jdGlvbihHcmFkaWVudCkge1xuXG5cdHJldHVybiBHcmFkaWVudDtcblxufSk7XG4iLCJyZXR1cm4gcmVxdWlyZSgnbWFpbicpfSkpXG4iXX0=
