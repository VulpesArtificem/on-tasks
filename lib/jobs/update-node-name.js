// Copyright 2015, EMC, Inc.

'use strict';

module.exports = snmpNodeUpdateJobFactory;
var di = require('di');

di.annotate(snmpNodeUpdateJobFactory, new di.Provide('Job.Snmp.Node.Update'));
di.annotate(snmpNodeUpdateJobFactory, new di.Inject(
    'Job.Base',
    'Util',
    'Services.Waterline',
    'Logger'
    )
);
function snmpNodeUpdateJobFactory(BaseJob, util, waterline, Logger) {
    var logger = Logger.initialize(snmpNodeUpdateJobFactory);

    function SnmpNodeUpdateJob(options, context, taskId) {
        SnmpNodeUpdateJob.super_.call(this, logger, options, context, taskId);
        this.nodeId = this.context.target;
    }
    util.inherits(SnmpNodeUpdateJob, BaseJob);

    SnmpNodeUpdateJob.prototype._run = function _run() {
        var self = this;

        return waterline.nodes.findByIdentifier(self.nodeId)
        .then(function(node) {
            return [node, waterline.catalogs.findOne({ node : node.id })];
        })
        .spread(function (node, catalog) {

            return waterline.nodes.updateByIdentifier(node.id, {
                //use the numeric value of SNMPv2-MIB::sysDescr with
                //underscores to match sanitized database key format
                name: catalog.data['_1_3_6_1_2_1_1_1_0'] +
                    '_' + node.snmpSettings.host
            });
        })
        .then(function() {
            self._done();
        })
        .catch(function(err){
            self._done(err);
        });
    };
    return SnmpNodeUpdateJob;
}

