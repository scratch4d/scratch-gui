import React from 'react';
import DebuggerTabComponent from '../components/debugger-tab/debugger-tab.jsx';
import bindAll from 'lodash.bindall';
import PropTypes, {number} from 'prop-types';
import VM from 'scratch-vm';

import {run, setupJudge, Evaluation} from '@ftrprf/judge-core';
import {connect} from 'react-redux';
import {
    startDebugger,
    stopDebugger,
    setTrail,
    enableAnimation,
    disableAnimation,
    setAnimateIndex,
    setIntervalIndex,
    setTrailSkinId,
    setAnimationSkinId,
    setJudge,
    setCodeString,
    setTimeFrame,
    setNumberOfFrames,
    enableTimeSlider,
    resetTimeSlider,
    setTrailLength
} from '../reducers/debugger.js';
import {positionsAreEqual, updateSprite} from '../util.js';

class DebuggerTab extends React.Component {
    constructor (props) {
        super(props);

        bindAll(this, [
            'handleClickStart',
            'handleClickStop',
            'handleClickStep',
            'handleEditorChange',
            'handleTimeInput',
            'handleTimeMouseDown',
            'handleTimeMouseUp',
            'handleTrailInput',
            'handleTrailMouseDown',
            'handleTrailMouseUp',
            'updateAnimation'
        ]);

        // The time interval after which the animation must be updated (in ms).
        this.ANIMATION_INTERVAL = 100;
    }

    componentDidUpdate (prevProps) {
        const {timeFrame: prevTimeFrame, trailLength: prevTrailLength} = prevProps;
        const {timeFrame, trailLength} = this.props;

        // If the time or trail slider changed value, reset the current trail.
        if (!this.props.isRunning && (prevTimeFrame !== timeFrame || prevTrailLength !== trailLength)) {
            this.resetTrail();
        }
    }

    async handleClickStart () {
        clearInterval(this.props.intervalIndex);
        this.props.setTrail([]);
        this.props.setAnimateIndex(0);

        this.props.startDebugger();
        this.props.disableAnimation();

        this.props.resetTimeSlider();

        const currentProject = await this.props.vm.saveProjectSb3().then(r => r.arrayBuffer());

        const config = {
            submission: currentProject,
            template: currentProject,
            canvas: this.props.vm.renderer.canvas,
            testPlan: this.props.codeString
        };

        const {
            context,
            judge,
            templateJson,
            submissionJson,
            testPlan
        } = await setupJudge(config, this.props.vm);

        this.props.setJudge(judge);

        const oldFunction = judge.log.addFrame.bind(judge.log);
        judge.log.addFrame = (_context, _block) => {
            oldFunction(_context, _block);

            this.props.setNumberOfFrames(this.props.numberOfFrames + 1);
        };

        // Initialize the pen skin and pen layer to draw the trail on.
        const trailSkinId = judge.vm.renderer.createPenSkin();
        judge.vm.renderer.updateDrawableSkinId(judge.vm.renderer.createDrawable('pen'), trailSkinId);
        this.props.setTrailSkinId(trailSkinId);

        // Initialize the pen skin and pen layer to draw the animations on.
        const animationSkinId = judge.vm.renderer.createPenSkin();
        judge.vm.renderer.updateDrawableSkinId(judge.vm.renderer.createDrawable('pen'), animationSkinId);
        this.props.setAnimationSkinId(animationSkinId);

        const evalInput = {
            templateJson: templateJson,
            submissionJson: submissionJson,
            testPlan: testPlan
        };

        await run(evalInput, context, judge);
    }

    handleClickStop () {
        if (!this.props.animate && this.props.isRunning) {
            this.props.stopDebugger();
            this.props.enableAnimation();

            this.props.setIntervalIndex(setInterval(this.updateAnimation, this.ANIMATION_INTERVAL));
        }

        if (this.props.judge) {
            this.props.enableTimeSlider();

            this.props.judge.output.closeJudgement();
            this.props.judge.vm.stopAll();
        }
    }

    handleClickStep () {

    }

    handleEditorChange (newValue) {
        this.props.setCodeString(newValue);
    }

    handleTimeInput (event) {
        this.props.setTimeFrame(parseInt(event.target.value, 10));
    }

    handleTimeMouseDown () {
        if (!this.props.isRunning) {
            this.props.disableAnimation();
            this.props.judge.vm.renderer.penClear(this.props.animationSkinId);
        }
    }

    handleTimeMouseUp () {
        if (!this.props.isRunning) {
            this.props.enableAnimation();
        }
    }

    handleTrailInput (event) {
        this.props.setTrailLength(parseInt(event.target.value, 10));
    }

    handleTrailMouseDown () {
        if (!this.props.isRunning) {
            this.props.disableAnimation();
            if (this.props.judge) {
                this.props.judge.vm.renderer.penClear(this.props.animationSkinId);
            }
        }
    }

    handleTrailMouseUp () {
        if (!this.props.isRunning) {
            this.props.enableAnimation();
        }
    }

    resetTrail () {
        if (!this.props.judge) {
            return;
        }

        this.props.setAnimateIndex(0);

        this.props.judge.vm.renderer.penClear(this.props.trailSkinId);
        this.props.judge.vm.renderer.penClear(this.props.animationSkinId);

        const previousPositions = new Map();

        let renderedAmount = 0;
        let currentIndex = this.props.timeFrame;

        const newTrail = [];

        while (renderedAmount < this.props.trailLength && currentIndex >= 0) {
            const frame = this.props.judge.log.frames[currentIndex];

            for (const spriteLog of frame.sprites) {
                // Request the Target from the runtime by its name.
                const sprite = this.props.judge.vm.runtime.getSpriteTargetByName(spriteLog.name);
                if (sprite) {
                    const previousPosition = previousPositions.get(spriteLog.name);
                    const currentPosition = [spriteLog.x, spriteLog.y];

                    if (currentIndex !== this.props.timeFrame &&
                        !positionsAreEqual(previousPosition, currentPosition)
                    ) {
                        this.props.judge.vm.renderer.updateDrawableEffect(sprite.drawableID, 'ghost', 90);
                        previousPositions.set(spriteLog.name, currentPosition);

                        updateSprite(sprite, spriteLog);
                        this.props.judge.vm.renderer.penStamp(this.props.trailSkinId, sprite.drawableID);
                        newTrail.unshift(currentIndex);
                        renderedAmount++;
                    }
                }
            }

            currentIndex--;
        }

        this.props.setTrail(newTrail);

        const frame = this.props.judge.log.frames[this.props.timeFrame];
        for (const spriteLog of frame.sprites) {
            // Request the Target from the runtime by its name.
            const sprite = this.props.judge.vm.runtime.getSpriteTargetByName(spriteLog.name);
            if (sprite) {
                this.props.judge.vm.renderer.updateDrawableEffect(sprite.drawableID, 'ghost', 0);
                updateSprite(sprite, spriteLog);
            }
        }
    }

    updateAnimation () {
        if (this.props.animate && this.props.trail.length > 0 && this.props.judge) {
            this.props.judge.vm.renderer.penClear(this.props.animationSkinId);

            const index = this.props.trail[this.props.animateIndex];
            let frame = this.props.judge.log.frames[index];

            for (const spriteLog of frame.sprites) {
                // Request the Target from the runtime by its name
                const sprite = this.props.judge.vm.runtime.getSpriteTargetByName(spriteLog.name);
                if (sprite) {
                    this.props.judge.vm.renderer.updateDrawableEffect(sprite.drawableID, 'ghost', 50);
                    updateSprite(sprite, spriteLog);
                    this.props.judge.vm.renderer.penStamp(this.props.animationSkinId, sprite.drawableID);
                }
            }

            frame = this.props.judge.log.frames[this.props.timeFrame];
            for (const spriteLog of frame.sprites) {
                // Request the Target from the runtime by its name
                const sprite = this.props.judge.vm.runtime.getSpriteTargetByName(spriteLog.name);
                if (sprite) {
                    this.props.judge.vm.renderer.updateDrawableEffect(sprite.drawableID, 'ghost', 0);
                    updateSprite(sprite, spriteLog);
                }
            }

            this.props.setAnimateIndex((this.props.animateIndex + 1) % this.props.trail.length);
        }
    }

    render () {
        return (
            <DebuggerTabComponent
                {...this.props}
                onClickStart={this.handleClickStart}
                onClickStop={this.handleClickStop}
                onClickStep={this.handleClickStep}
                onEditorChange={this.handleEditorChange}
                onTimeInput={this.handleTimeInput}
                onTimeMouseDown={this.handleTimeMouseDown}
                onTimeMouseUp={this.handleTimeMouseUp}
                onTrailInput={this.handleTrailInput}
                onTrailMouseDown={this.handleTrailMouseDown}
                onTrailMouseUp={this.handleTrailMouseUp}
            />
        );
    }
}

const mapStateToProps = state => ({
    isRunning: state.scratchGui.debugger.isRunning,
    trail: state.scratchGui.debugger.trail,
    animate: state.scratchGui.debugger.animate,
    animateIndex: state.scratchGui.debugger.animateIndex,
    intervalIndex: state.scratchGui.debugger.intervalIndex,
    trailSkinId: state.scratchGui.debugger.trailSkinId,
    animationSkinId: state.scratchGui.debugger.animationSkinId,
    submissionUpload: state.scratchGui.debugger.submissionUpload,
    judge: state.scratchGui.debugger.judge,
    codeString: state.scratchGui.debugger.codeString,
    timeFrame: state.scratchGui.debugger.timeFrame,
    numberOfFrames: state.scratchGui.debugger.numberOfFrames,
    timeSliderDisabled: state.scratchGui.debugger.timeSliderDisabled,
    trailLength: state.scratchGui.debugger.trailLength,
    timeSliderKey: state.scratchGui.debugger.timeSliderKey
});

const mapDispatchToProps = dispatch => ({
    startDebugger: () => dispatch(startDebugger()),
    stopDebugger: () => dispatch(stopDebugger()),
    setTrail: trail => dispatch(setTrail(trail)),
    enableAnimation: () => dispatch(enableAnimation()),
    disableAnimation: () => dispatch(disableAnimation()),
    setAnimateIndex: animateIndex => dispatch(setAnimateIndex(animateIndex)),
    setIntervalIndex: intervalIndex => dispatch(setIntervalIndex(intervalIndex)),
    setTrailSkinId: trailSkinId => dispatch(setTrailSkinId(trailSkinId)),
    setAnimationSkinId: animationSkinId => dispatch(setAnimationSkinId(animationSkinId)),
    setJudge: judge => dispatch(setJudge(judge)),
    setCodeString: codeString => dispatch(setCodeString(codeString)),
    setTimeFrame: timeFrame => dispatch(setTimeFrame(timeFrame)),
    setNumberOfFrames: numberOfFrames => dispatch(setNumberOfFrames(numberOfFrames)),
    enableTimeSlider: () => dispatch(enableTimeSlider()),
    resetTimeSlider: () => dispatch(resetTimeSlider()),
    setTrailLength: trailLength => dispatch(setTrailLength(trailLength))
});

DebuggerTab.propTypes = {
    // State
    isRunning: PropTypes.bool.isRequired,
    trail: PropTypes.arrayOf(number).isRequired,
    animate: PropTypes.bool.isRequired,
    animateIndex: PropTypes.number.isRequired,
    intervalIndex: PropTypes.number,
    trailSkinId: PropTypes.number,
    animationSkinId: PropTypes.number,
    judge: PropTypes.instanceOf(Evaluation),
    codeString: PropTypes.string.isRequired,
    timeFrame: PropTypes.number.isRequired,
    numberOfFrames: PropTypes.number.isRequired,
    timeSliderDisabled: PropTypes.bool.isRequired,
    trailLength: PropTypes.number.isRequired,
    timeSliderKey: PropTypes.bool.isRequired,
    // Dispatch
    startDebugger: PropTypes.func.isRequired,
    stopDebugger: PropTypes.func.isRequired,
    setTrail: PropTypes.func.isRequired,
    enableAnimation: PropTypes.func.isRequired,
    disableAnimation: PropTypes.func.isRequired,
    setAnimateIndex: PropTypes.func.isRequired,
    setIntervalIndex: PropTypes.func.isRequired,
    setTrailSkinId: PropTypes.func.isRequired,
    setAnimationSkinId: PropTypes.func.isRequired,
    setJudge: PropTypes.func.isRequired,
    setCodeString: PropTypes.func.isRequired,
    setTimeFrame: PropTypes.func.isRequired,
    setNumberOfFrames: PropTypes.func.isRequired,
    enableTimeSlider: PropTypes.func.isRequired,
    resetTimeSlider: PropTypes.func.isRequired,
    setTrailLength: PropTypes.func.isRequired,
    // Other props
    vm: PropTypes.instanceOf(VM).isRequired
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DebuggerTab);
