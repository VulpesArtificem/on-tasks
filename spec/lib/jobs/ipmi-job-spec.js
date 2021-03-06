// Copyright 2015, EMC, Inc.
/* jshint node:true */

'use strict';

var uuid = require('node-uuid'),
    events = require('events'),
    waterline = {};

describe(require('path').basename(__filename), function () {
    var base = require('./base-spec');
    var pollerHelper;

    base.before(function (context) {
        // create a child injector with on-core and the base pieces we need to test this
        helper.setupInjector([
            helper.require('/spec/mocks/logger.js'),
            helper.requireGlob('/lib/services/*.js'),
            helper.require('/lib/utils/job-utils/ipmitool.js'),
            helper.require('/lib/utils/job-utils/ipmi-parser.js'),
            helper.require('/lib/jobs/base-job.js'),
            helper.require('/lib/jobs/ipmi-job.js'),
            helper.require('/lib/utils/job-utils/poller-helper.js'),
            helper.di.simpleWrapper(waterline,'Services.Waterline')
        ]);

        context.Jobclass = helper.injector.get('Job.Ipmi');
        pollerHelper = helper.injector.get('JobUtils.PollerHelper');
    });

    describe('Base', function () {
        base.examples();
    });

    describe("ipmi-job", function() {
        var testEmitter = new events.EventEmitter();
        beforeEach(function() {
            this.sandbox = sinon.sandbox.create();
            waterline.workitems = {
                update: this.sandbox.stub().resolves(),
                findOne: this.sandbox.stub().resolves({node: "any"}),
                setSucceeded: this.sandbox.stub().resolves(),
                setFailed: this.sandbox.stub().resolves()
            };
            var graphId = uuid.v4();
            this.ipmi = new this.Jobclass({}, { graphId: graphId }, uuid.v4());
            this.ipmi._publishPollerAlert = this.sandbox.stub().resolves();
            expect(this.ipmi.routingKey).to.equal(graphId);
        });

        it("should have a _run() method", function() {
            expect(this.ipmi).to.have.property('_run').with.length(0);
        });

        it("should have a sdr command subscribe method", function() {
            expect(this.ipmi).to.have.property('_subscribeRunIpmiCommand').with.length(3);
        });

        it("should listen for ipmi sdr command requests", function(done) {
            var self = this;
            var config = {
                host: '10.1.1.',
                user: 'admin',
                password: 'admin',
                workItemId: 'testworkitemid'
            };
            self.ipmi.collectIpmiSdr = sinon.stub().resolves();
            pollerHelper.getNodeAlertMsg = sinon.stub().resolves({});
            self.ipmi._publishIpmiCommandResult = sinon.stub();
            self.ipmi._subscribeRunIpmiCommand = function(routingKey, type, callback) {
                if (type === 'sdr') {
                    testEmitter.on('test-subscribe-ipmi-sdr-command', function(config) {
                        // BaseJob normally binds this callback to its subclass instance,
                        // so do the equivalent
                        callback.call(self.ipmi, config);
                    });
                }
            };

            self.ipmi._run()
            .then(function() {
                _.forEach(_.range(100), function(i) {
                    var _config = _.cloneDeep(config);
                    _config.host += i;
                    testEmitter.emit('test-subscribe-ipmi-sdr-command', _config);
                });

                setImmediate(function() {
                    try {
                        expect(self.ipmi.collectIpmiSdr.callCount).to.equal(100);
                        expect(pollerHelper.getNodeAlertMsg.callCount).to.equal(100);
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            });
        });

        it("should add a concurrent request", function() {
            expect(this.ipmi.concurrentRequests('test', 'chassis')).to.equal(false);
            this.ipmi.addConcurrentRequest('test', 'chassis');
            expect(this.ipmi.concurrent).to.have.property('test')
                .with.property('chassis').that.equals(1);
        });

        it("should return true if there are requests outstanding", function() {
            expect(this.ipmi.concurrentRequests('test', 'chassis')).to.equal(false);
            this.ipmi.addConcurrentRequest('test', 'chassis');
            expect(this.ipmi.concurrentRequests('test', 'chassis')).to.equal(true);
        });
        
        it("should send power state alert", function() {
            var self = this;
            var testState = {power:'ON'};
            var testData = {workItemId: 'abc'};
            self.ipmi.cachedPowerState[testData.workItemId] = 'OFF'
            return self.ipmi.powerStateAlerter(testState, testData)
            .then(function(status) {
                expect(status).to.deep.equal(testState);
                expect(self.ipmi.cachedPowerState[testData.workItemId]).to.equal(status.power);
            });
        });
    });
});
