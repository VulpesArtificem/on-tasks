// Copyright 2015, Renasar Technologies Inc.
/* jshint node:true */

'use strict';

describe(require('path').basename(__filename), function () {
    var base = require('./base-task-data-spec');

    base.before(function (context) {
        context.taskdefinition = helper.require('/lib/task-data/base-tasks/generate-enclosure.js');
    });

    describe('base-data', function () {
        base.examples();
    });

});
