(function () {

/*global iD*/
window.iD = function () {
    window.locale.en = iD.data.en;
    window.locale.current('en');

    var dispatch = d3.dispatch('enter', 'exit', 'change', 'levelchange'),
        context = {};

    // https://github.com/openstreetmap/iD/issues/772
    // http://mathiasbynens.be/notes/localstorage-pattern#comment-9
    var storage;
    try { storage = localStorage; } catch (e) {}  // eslint-disable-line no-empty
    storage = storage || (function() {
        var s = {};
        return {
            getItem: function(k) { return s[k]; },
            setItem: function(k, v) { s[k] = v; },
            removeItem: function(k) { delete s[k]; }
        };
    })();

    context.storage = function(k, v) {
        try {
            if (arguments.length === 1) return storage.getItem(k);
            else if (v === null) storage.removeItem(k);
            else storage.setItem(k, v);
        } catch (e) {
            // localstorage quota exceeded
            /* eslint-disable no-console */
            if (typeof console !== 'undefined') console.error('localStorage quota exceeded');
            /* eslint-enable no-console */
        }
    };


    /* Straight accessors. Avoid using these if you can. */
    var ui, connection, history;
    context.ui = function() { return ui; };
    context.connection = function() { return connection; };
    context.history = function() { return history; };


    /* Connection */
    function entitiesLoaded(err, result) {
        if (!err) history.merge(result.data, result.extent);
    }

    context.preauth = function(options) {
        connection.switch(options);
        return context;
    };

    context.loadTiles = function(projection, dimensions, callback) {
        function done(err, result) {
            entitiesLoaded(err, result);
            if (callback) callback(err, result);
        }
        connection.loadTiles(projection, dimensions, done);
    };

    context.loadEntity = function(id, callback) {
        function done(err, result) {
            entitiesLoaded(err, result);
            if (callback) callback(err, result);
        }
        connection.loadEntity(id, done);
    };

    context.zoomToEntity = function(id, zoomTo) {
        if (zoomTo !== false) {
            this.loadEntity(id, function(err, result) {
                if (err) return;
                var entity = _.find(result.data, function(e) { return e.id === id; });
                if (entity) { map.zoomTo(entity); }
            });
        }

        map.on('drawn.zoomToEntity', function() {
            if (!context.hasEntity(id)) return;
            map.on('drawn.zoomToEntity', null);
            context.on('enter.zoomToEntity', null);
            context.enter(iD.modes.Select(context, [id]));
        });

        context.on('enter.zoomToEntity', function() {
            if (mode.id !== 'browse') {
                map.on('drawn.zoomToEntity', null);
                context.on('enter.zoomToEntity', null);
            }
        });
    };

    var minEditableZoom = 16;
    context.minEditableZoom = function(_) {
        if (!arguments.length) return minEditableZoom;
        minEditableZoom = _;
        connection.tileZoom(_);
        return context;
    };


    /* History */
    var inIntro = false;
    context.inIntro = function(_) {
        if (!arguments.length) return inIntro;
        inIntro = _;
        return context;
    };

    context.save = function() {
        if (inIntro || (mode && mode.id === 'save') || d3.select('.modal').size()) return;
        history.save();
        if (history.hasChanges()) return t('save.unsaved_changes');
    };

    context.flush = function() {
        context.debouncedSave.cancel();
        connection.flush();
        features.reset();
        history.reset();
        _.each(iD.services, function(service) {
            var reset = service().reset;
            if (reset) reset(context);
        });
        return context;
    };


    /* Graph */
    context.hasEntity = function(id) {
        return history.graph().hasEntity(id);
    };
    context.entity = function(id) {
        return history.graph().entity(id);
    };
    context.childNodes = function(way) {
        return history.graph().childNodes(way);
    };
    context.geometry = function(id) {
        return context.entity(id).geometry(history.graph());
    };


    /* Modes */
    var mode;
    context.mode = function() {
        return mode;
    };
    context.enter = function(newMode) {
        if (mode) {
            mode.exit();
            dispatch.exit(mode);
        }

        mode = newMode;
        mode.enter();
        dispatch.enter(mode);
    };

    context.selectedIDs = function() {
        if (mode && mode.selectedIDs) {
            return mode.selectedIDs();
        } else {
            return [];
        }
    };


    /* Behaviors */
    context.install = function(behavior) {
        context.surface().call(behavior);
    };
    context.uninstall = function(behavior) {
        context.surface().call(behavior.off);
    };


    /* Copy/Paste */
    var copyIDs = [], copyGraph;
    context.copyGraph = function() { return copyGraph; };
    context.copyIDs = function(_) {
        if (!arguments.length) return copyIDs;
        copyIDs = _;
        copyGraph = history.graph();
        return context;
    };


    /* Background */
    var background;
    context.background = function() { return background; };


    /* Features */
    var features;
    context.features = function() { return features; };
    context.hasHiddenConnections = function(id) {
        var graph = history.graph(),
            entity = graph.entity(id);
        return features.hasHiddenConnections(entity, graph);
    };
    
    
    /* Map */
    var map;
    context.map = function() { return map; };
    context.layers = function() { return map.layers; };
    context.surface = function() { return map.surface; };
    context.editable = function() { return map.editable(); };

    context.surfaceRect = function() {
        // Work around a bug in Firefox.
        //   http://stackoverflow.com/questions/18153989/
        //   https://bugzilla.mozilla.org/show_bug.cgi?id=530985
        return context.surface().node().parentNode.getBoundingClientRect();
    };


    /* Levels */
    var level = 0;
    var availableLevels = [ 0 ];
    context.level = function() { return level; }
    context.availableLevels = function() { return availableLevels; }
    context.hasLevelsDefined = function(id) { return context.graph().entities[id].levels.length > 0; }
    context.updateAvailableLevels = function() {
		var entities = context.graph().entities;
		var levels = d3.set([ 0 ]);
		for(var i in entities) {
			var entity = entities[i];
			if(entity != undefined) {
				for(var l in entity.levels) {
					levels.add(entity.levels[l]);
				}
			}
		}
		levels = levels.values();
		for(var l in levels) {
			levels[l] = parseFloat(levels[l]);
		}
		levels.sort(iD.util.sortNumberArray);
		availableLevels = levels;
		
		context.updateLevelFromHash();
    }
    context.updateLevelFromHash = function() {
		if (context.storage('level') !== null) {
			var storedLevel = parseFloat(context.storage('level'));
			if(availableLevels.indexOf(storedLevel) >= 0) {
				if(storedLevel != level) {
					context.setLevel(storedLevel);
					
					//Restore selection if needed
					if (context.storage('id-level') !== null) {
						context.zoomToEntity(context.storage('id-level'), true);
						context.storage('id-level', null);
					}
				}
				context.storage('level', null);
			}
		}
	};
    context.levelUp = function() {
	    var al = context.availableLevels();
	    var lvlId = al.indexOf(level);
	    if(lvlId + 1 < al.length) { context.setLevel(al[lvlId+1]); }
    };
    context.levelDown = function() {
	    var al = context.availableLevels();
	    var lvlId = al.indexOf(level);
	    if(lvlId > 0) { context.setLevel(al[lvlId-1]); }
    };
    context.setLevel = function(l) {
	    var al = context.availableLevels();
	    if(al.indexOf(l) >= 0 && level != l) {
		    level = l;
			context.enter(iD.modes.Browse(context));
		    context.pan([0,0]);
		    dispatch.levelchange();
	    }
    };


    /* Debug */
    var debugFlags = {
        tile: false,
        collision: false,
        imagery: false,
        imperial: false,
        driveLeft: false
    };
    context.debugFlags = function() {
        return debugFlags;
    };
    context.setDebug = function(flag, val) {
        if (arguments.length === 1) val = true;
        debugFlags[flag] = val;
        dispatch.change();
        return context;
    };
    context.getDebug = function(flag) {
        return flag && debugFlags[flag];
    };


    /* Presets */
    var presets;
    context.presets = function(_) {
        if (!arguments.length) return presets;
        presets.load(_);
        iD.areaKeys = presets.areaKeys();
        return context;
    };


    /* Imagery */
    context.imagery = function(_) {
        background.load(_);
        return context;
    };


    /* Container */
    var container, embed;
    context.container = function(_) {
        if (!arguments.length) return container;
        container = _;
        container.classed('id-container', true);
        return context;
    };
    context.embed = function(_) {
        if (!arguments.length) return embed;
        embed = _;
        return context;
    };


    /* Taginfo */
    var taginfo;
    context.taginfo = function(_) {
        if (!arguments.length) return taginfo;
        taginfo = _;
        return context;
    };


    /* Assets */
    var assetPath = '';
    context.assetPath = function(_) {
        if (!arguments.length) return assetPath;
        assetPath = _;
        return context;
    };

    var assetMap = {};
    context.assetMap = function(_) {
        if (!arguments.length) return assetMap;
        assetMap = _;
        return context;
    };

    context.asset = function(_) {
        var filename = assetPath + _;
        return assetMap[filename] || filename;
    };

    context.imagePath = function(_) {
        return context.asset('img/' + _);
    };

    var locale, localePath;
    context.locale = function(loc, path) {
        if (!arguments.length) return locale;
        locale = loc;
        localePath = path;
        return context;
    };

    context.loadLocale = function(cb) {
        if (locale && locale !== 'en' && iD.data.locales.indexOf(locale) !== -1) {
            localePath = localePath || context.asset('locales/' + locale + '.json');
            d3.json(localePath, function(err, result) {
                window.locale[locale] = result;
                window.locale.current(locale);
                cb();
            });
        } else {
            cb();
        }
    };


    /* Init */

    context.projection = iD.geo.RawMercator();

    locale = iD.Detect().locale;
    if (locale && iD.data.locales.indexOf(locale) === -1) {
        locale = locale.split('-')[0];
    }

    history = iD.History(context);
    context.graph = history.graph;
    context.changes = history.changes;
    context.intersects = history.intersects;

    // Debounce save, since it's a synchronous localStorage write,
    // and history changes can happen frequently (e.g. when dragging).
    context.debouncedSave = _.debounce(context.save, 350);
    function withDebouncedSave(fn) {
        return function() {
            var result = fn.apply(history, arguments);
            context.debouncedSave();
            return result;
        };
    }

    context.perform = withDebouncedSave(history.perform);
    context.replace = withDebouncedSave(history.replace);
    context.pop = withDebouncedSave(history.pop);
    context.overwrite = withDebouncedSave(history.overwrite);
    context.undo = withDebouncedSave(history.undo);
    context.redo = withDebouncedSave(history.redo);

    ui = iD.ui.init(context);

    connection = iD.Connection();

    background = iD.Background(context);

    features = iD.Features(context);

    map = iD.Map(context);
    context.mouse = map.mouse;
    context.extent = map.extent;
    context.pan = map.pan;
    context.zoomIn = map.zoomIn;
    context.zoomOut = map.zoomOut;
    context.zoomInFurther = map.zoomInFurther;
    context.zoomOutFurther = map.zoomOutFurther;
    context.redrawEnable = map.redrawEnable;

    presets = iD.presets.presets();

    return d3.rebind(context, dispatch, 'on');
};

iD.version = '1.9.6';

})();
