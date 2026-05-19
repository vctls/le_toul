/**
 * Regions are visual overlays on the waveform that can be used to mark segments of audio.
 * Regions can be clicked on, dragged and resized.
 * You can set the color and content of each region, as well as their HTML content.
 * Regions can be open-ended, meaning they have no end time. A region with no end time
 * extends to the end of the audio or the start of the next region.
 */

import { makeDraggable } from 'wavesurfer.js/dist/draggable';
import { BasePlugin } from 'wavesurfer.js/dist/base-plugin';
import { BasePluginEvents } from 'wavesurfer.js/dist/base-plugin';
import EventEmitter from 'wavesurfer.js/dist/event-emitter'
import createElement from 'wavesurfer.js/dist/dom'
import { property } from 'lodash-es';

export class OverlapError extends Error {
    constructor(region: Region, otherRegion: Region) {
        super(`Region ${region.id} overlaps with existing region ${otherRegion.id}`)
    }
}

export type RegionsPluginOptions = undefined

export type RegionsPluginEvents = BasePluginEvents & {
    /** When a region is created */
    'region-created': [region: Region]
    /** When a region is being updated */
    'region-update': [region: Region, side?: 'start' | 'end']
    /** When a region is done updating */
    'region-updated': [region: Region]
    /** When a region is removed */
    'region-removed': [region: Region]
    /** When a region is clicked */
    'region-clicked': [region: Region, e: MouseEvent]
    /** When a region is double-clicked */
    'region-double-clicked': [region: Region, e: MouseEvent]
    /** When playback enters a region */
    'region-in': [region: Region]
    /** When playback leaves a region */
    'region-out': [region: Region]
}

export type RegionEvents = {
    /** Before the region is removed */
    remove: []
    /** When the region's parameters are being updated */
    update: [side?: 'start' | 'end']
    /** When dragging or resizing is finished */
    'update-end': []
    /** On play */
    play: []
    /** On mouse click */
    click: [event: MouseEvent]
    /** Double click */
    dblclick: [event: MouseEvent]
    /** Mouse over */
    over: [event: MouseEvent]
    /** Mouse leave */
    leave: [event: MouseEvent]
}

export type RegionParams = {
    /** The id of the region, any string */
    id?: string
    /** The start position of the region (in seconds) */
    start: number
    /** The end position of the region (in seconds) */
    end?: number
    /** Allow/dissallow resizing the region */
    resize?: boolean
    /** The color of the region (CSS color) */
    color?: string
    /** Content string */
    content?: string
    /** Min length when resizing (in seconds) */
    minLength?: number
    /** Max length when resizing (in seconds) */
    maxLength?: number
    /** The index of the channel */
    channelIdx?: number
    /** Allow/Disallow contenteditable property for content */
    contentEditable?: boolean
}

class SingleRegion extends EventEmitter<RegionEvents> implements Region {
    public element: HTMLElement
    public id: string
    public start: number
    public resize: boolean
    public color: string
    public content?: HTMLElement
    public minLength = 0
    public maxLength = Infinity
    public channelIdx: number
    public contentEditable = false
    public subscriptions: (() => void)[] = []

    private _explicitEnd?: number
    private _nextRegion?: Region
    private _prevRegion?: Region

    get end() {
        return this._explicitEnd ?? this._nextRegion?.start ?? this.totalDuration;
    }

    set end(time: number | undefined) {
        this._explicitEnd = time
    }

    get nextRegion() {
        return this._nextRegion
    }

    set nextRegion(region: Region | undefined) {
        // Clean up old subscription if it exists
        if (this._nextRegion) {
            const index = this.subscriptions.findIndex(sub =>
                sub.toString().includes('onNeighborMoved')
            );
            if (index !== -1) {
                this.subscriptions[index]();
                this.subscriptions.splice(index, 1);
            }
        }

        this._nextRegion = region;
        if (region) {
            // Add new subscription
            this.subscriptions.push(
                region.on('update', () => this.onNeighborMoved('next'))
            );
        }
        this.renderPosition();
    }

    get prevRegion() {
        return this._prevRegion
    }

    set prevRegion(region: Region | undefined) {
        this._prevRegion = region
    }

    public get isOpenEnded(): boolean {
        return this._explicitEnd == undefined
    }

    constructor(params: RegionParams, private totalDuration: number, private numberOfChannels = 0) {
        super()

        this.subscriptions = []
        this.id = params.id || `region-${Math.random().toString(32).slice(2)}`
        this.start = this.clampPosition(params.start)
        this.end = params.end;
        this.resize = params.resize ?? true
        this.color = params.color ?? 'rgba(0, 0, 0, 0.1)'
        this.minLength = params.minLength ?? this.minLength
        this.maxLength = params.maxLength ?? this.maxLength
        this.channelIdx = params.channelIdx ?? -1
        this.contentEditable = params.contentEditable ?? this.contentEditable
        this.element = this.initElement()
        this.setContent(params.content)
        this.setPart()

        this.renderPosition()
        this.initMouseEvents()
    }

    private clampPosition(time: number): number {
        const maxEndTime = this.nextRegion ? this.nextRegion.start : this.totalDuration
        return Math.max(0, Math.min(maxEndTime, time))
    }

    private setPart() {
        const isMarker = this.start === this.end
        this.element.setAttribute('part', `${isMarker ? 'marker' : 'region'} ${this.id}`)
    }

    private addResizeHandles(element: HTMLElement) {
        const handleStyle = {
            position: 'absolute',
            zIndex: '2',
            width: '6px',
            height: '100%',
            top: '0',
            cursor: 'ew-resize',
            wordBreak: 'keep-all',
        }

        const leftHandle = createElement(
            'div',
            {
                part: 'region-handle region-handle-left',
                style: {
                    ...handleStyle,
                    left: '0',
                    borderLeft: '2px solid rgba(0, 0, 0, 0.5)',
                    borderRadius: '2px 0 0 2px',
                },
            },
            element,
        )

        // Resize
        const resizeThreshold = 1
        this.subscriptions.push(
            makeDraggable(
                leftHandle,
                (dx) => this.onResize(dx, 'start'),
                () => null,
                () => this.onEndResizing(),
                resizeThreshold,
            )
        )

        // Always create a right handle. For open-ended regions it acts as a
        // "ghost" handle: hidden by default, revealed on hover. Dragging it
        // materializes the explicit end (introduces a gap before the next region).
        const rightHandle = createElement(
            'div',
            {
                part: 'region-handle region-handle-right',
                style: {
                    ...handleStyle,
                    right: '0',
                    borderRadius: '0 2px 2px 0',
                    transition: 'opacity 0.15s ease',
                },
            },
            element,
        )
        this.applyRightHandleAppearance(rightHandle)

        const showGhost = () => {
            if (this.isOpenEnded) rightHandle.style.opacity = '0.6'
        }
        const hideGhost = () => {
            if (this.isOpenEnded) rightHandle.style.opacity = '0'
        }
        element.addEventListener('mouseenter', showGhost)
        element.addEventListener('mouseleave', hideGhost)
        this.subscriptions.push(() => {
            element.removeEventListener('mouseenter', showGhost)
            element.removeEventListener('mouseleave', hideGhost)
        })

        this.subscriptions.push(
            makeDraggable(
                rightHandle,
                (dx) => this.onResize(dx, 'end'),
                () => this.onStartRightResize(),
                () => this.onEndResizing(),
                resizeThreshold,
            ),
        )
    }

    private applyRightHandleAppearance(rightHandle: HTMLElement) {
        if (this.isOpenEnded) {
            rightHandle.style.borderRight = '2px dashed rgba(0, 0, 0, 0.5)'
            rightHandle.style.opacity = '0'
        } else {
            rightHandle.style.borderRight = '2px solid rgba(0, 0, 0, 0.5)'
            rightHandle.style.opacity = '1'
        }
    }

    private onStartRightResize() {
        // If this is a ghost handle, materialize the implicit end so the
        // standard end-resize math works for the rest of the drag. Loose
        // equality so we catch both `undefined` and `null`. Regions are
        // commonly constructed with `end: null`.
        if (this._explicitEnd == null) {
            this._explicitEnd = this.end
            const rightHandle = this.element.querySelector(
                '[part*="region-handle-right"]',
            ) as HTMLElement | null
            if (rightHandle) this.applyRightHandleAppearance(rightHandle)
        }
    }

    private removeResizeHandles(element: HTMLElement) {
        const leftHandle = element.querySelector('[part*="region-handle-left"]')
        const rightHandle = element.querySelector('[part*="region-handle-right"]')
        if (leftHandle) {
            element.removeChild(leftHandle)
        }
        if (rightHandle) {
            element.removeChild(rightHandle)
        }
    }

    private initElement() {
        const isMarker = this.start === this.end;

        let elementTop = 0;
        let elementHeight = 'auto'; // Change to auto to fit content

        if (this.channelIdx >= 0 && this.channelIdx < this.numberOfChannels) {
            elementHeight = 'auto'; // Change to auto to fit content
            elementTop = (100 / this.numberOfChannels) * this.channelIdx;
        }

        const element = createElement('div', {
            style: {
                position: 'absolute',
                top: `${elementTop}%`,
                height: elementHeight, // Set height to auto
                backgroundColor: isMarker ? 'none' : this.color,
                borderLeft: isMarker ? '2px solid ' + this.color : 'none',
                borderRadius: '2px',
                boxSizing: 'border-box',
                transition: 'background-color 0.2s ease',
                cursor: 'default',
                pointerEvents: 'all',
            },
        });

        // Add resize handles
        if (!isMarker && this.resize) {
            this.addResizeHandles(element);
        }

        return element;
    }

    private renderPosition() {
        const start = this.start / this.totalDuration
        const end = (this.totalDuration - this.end) / this.totalDuration
        this.element.style.left = `${start * 100}%`
        this.element.style.right = `${end * 100}%`
    }

    private initMouseEvents() {
        const { element } = this
        if (!element) return

        element.addEventListener('click', (e) => this.emit('click', e))
        element.addEventListener('mouseenter', (e) => this.emit('over', e))
        element.addEventListener('mouseleave', (e) => this.emit('leave', e))
        element.addEventListener('dblclick', (e) => this.emit('dblclick', e))

        if (this.contentEditable && this.content) {
            this.content.addEventListener('click', (e) => this.onContentClick(e))
            this.content.addEventListener('blur', () => this.onContentBlur())
        }
    }

    public _onUpdate(dx: number, side: 'start' | 'end') {
        if (!this.element.parentElement) return
        const { width } = this.element.parentElement.getBoundingClientRect()
        const deltaSeconds = (dx / width) * this.totalDuration
        const newStart = !side || side === 'start' ? this.start + deltaSeconds : this.start
        const newEnd = !side || side === 'end' ? this._explicitEnd + deltaSeconds : this.end
        const length = newEnd - newStart

        // If previous region is open-ended, we can't resize past its start. Otherwise 
        // we can't resize past its end.
        const hasBadOverlap = this.prevRegion
            && ((newStart < this.prevRegion.end && !this.prevRegion.isOpenEnded)
                || this.prevRegion.isOpenEnded && newStart < this.prevRegion.start);
        if (
            !hasBadOverlap &&
            newStart >= 0 &&
            newEnd <= this.totalDuration &&
            (this.nextRegion ? newEnd <= this.nextRegion.start : true) &&
            newStart <= newEnd &&
            length >= this.minLength &&
            length <= this.maxLength
        ) {
            this.start = newStart
            this._explicitEnd = this._explicitEnd && newEnd

            this.renderPosition()
            this.emit('update', side)
        }
    }

    private onNeighborMoved(side: 'prev' | 'next') {
        if (side === 'prev' || !this.isOpenEnded) return

        const newEnd = this.nextRegion?.start
        if (newEnd !== undefined) {
            this.renderPosition()
        }
    }

    private onResize(dx: number, side: 'start' | 'end') {
        if (!this.resize) return
        this._onUpdate(dx, side)
    }

    private onEndResizing() {
        if (!this.resize) return

        // If the user dragged the end up against the next region's start (or
        // the end of the audio), drop the explicit end and revert to open-ended.
        if (this._explicitEnd != null) {
            const snapThreshold = 0.05
            const ceiling = this._nextRegion?.start ?? this.totalDuration
            if (this._explicitEnd >= ceiling - snapThreshold) {
                this._explicitEnd = undefined
                this.renderPosition()
                const rightHandle = this.element.querySelector(
                    '[part*="region-handle-right"]',
                ) as HTMLElement | null
                if (rightHandle) this.applyRightHandleAppearance(rightHandle)
            }
        }

        this.emit('update-end')
    }

    private onContentClick(event: MouseEvent) {
        event.stopPropagation()
        const contentContainer = event.target as HTMLDivElement
        contentContainer.focus()
        this.emit('click', event)
    }

    public onContentBlur() {
        this.emit('update-end')
    }

    public _setTotalDuration(totalDuration: number) {
        this.totalDuration = totalDuration
        this.renderPosition()
    }

    /** Play the region from the start */
    public play() {
        this.emit('play')
    }

    /** Set the HTML content of the region */
    public setContent(content: string | undefined) {
        this.content?.remove();
        if (!content) {
            this.content = undefined;
            return;
        }
        this.content = createElement('div', {
            style: {
                padding: `0em 0.2em`,
                display: 'inline-block',
                color: 'black',
                whiteSpace: 'nowrap',    // Prevent line breaks
                overflow: 'visible',      // Allow content to overflow
                position: 'relative',     // Enable z-index
                zIndex: '1',             // Ensure content stays below handle
            },
            textContent: content,
        });
        if (this.contentEditable) {
            this.content.contentEditable = 'true';
        }
        this.content.setAttribute('part', 'region-content');
        this.element.appendChild(this.content);
    }

    /** Update the region's options */
    public setOptions(options: Omit<RegionParams, 'minLength' | 'maxLength'>) {
        if (options.color) {
            this.color = options.color
            this.element.style.backgroundColor = this.color
        }

        if (options.start !== undefined || options.end !== undefined) {
            const isMarker = this.start === this.end
            this.start = this.clampPosition(options.start ?? this.start)
            this._explicitEnd = this.clampPosition(options.end ?? (isMarker ? this.start : this.end))
            this.renderPosition()
            this.setPart()
        }

        if (options.content) {
            this.setContent(options.content)
        }

        if (options.id) {
            this.id = options.id
            this.setPart()
        }

        if (options.resize !== undefined && options.resize !== this.resize) {
            const isMarker = this.start === this.end
            this.resize = options.resize
            if (this.resize && !isMarker) {
                this.addResizeHandles(this.element)
            } else {
                this.removeResizeHandles(this.element)
            }
        }
    }

    /** Remove the region */
    public remove() {
        // Clean up subscriptions before removing element
        this.subscriptions.forEach((unsubscribe) => unsubscribe());
        this.subscriptions = [];

        // todo: fix firstRegion in plugin
        if (this.prevRegion) {
            this.prevRegion.nextRegion = this.nextRegion;
        }
        if (this.nextRegion) {
            this.nextRegion.prevRegion = this.prevRegion;
        }
        // Clear the region's references
        this.nextRegion = undefined;
        this.prevRegion = undefined;

        this.emit('remove');
        if (this.element) {
            this.element.remove();
            // This violates the type but we want to clean up the DOM reference
            this.element = null as unknown as HTMLElement;
        }
    }
}

class RegionsPlugin extends BasePlugin<RegionsPluginEvents, RegionsPluginOptions> {
    private regions: Region[] = []
    private regionsContainer: HTMLElement
    private firstRegion?: Region

    /** Create an instance of RegionsPlugin */
    constructor(options?: RegionsPluginOptions) {
        super(options)
        this.regionsContainer = this.initRegionsContainer()
    }

    /** Create an instance of RegionsPlugin */
    public static create(options?: RegionsPluginOptions) {
        return new RegionsPlugin(options)
    }

    /** Called by wavesurfer, don't call manually */
    onInit() {
        if (!this.wavesurfer) {
            throw Error('WaveSurfer is not initialized')
        }
        this.wavesurfer.getWrapper().appendChild(this.regionsContainer)

        let activeRegions: Region[] = []
        this.subscriptions.push(
            this.wavesurfer.on('timeupdate', (currentTime) => {
                // Detect when regions are being played
                const playedRegions = this.regions.filter(
                    (region) =>
                        region.start <= currentTime &&
                        (region.end === region.start ? region.start + 0.05 : region.end) >= currentTime,
                )

                // Trigger region-in when activeRegions doesn't include a played regions
                playedRegions.forEach((region) => {
                    if (!activeRegions.includes(region)) {
                        this.emit('region-in', region)
                    }
                })

                // Trigger region-out when activeRegions include a un-played regions
                activeRegions.forEach((region) => {
                    if (!playedRegions.includes(region)) {
                        this.emit('region-out', region)
                    }
                })

                // Update activeRegions only played regions
                activeRegions = playedRegions
            }),
        )
    }

    private initRegionsContainer(): HTMLElement {
        return createElement('div', {
            style: {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '3',
                pointerEvents: 'none',
            },
        })
    }

    /** Get all created regions */
    public getRegions(): Region[] {
        return this.regions
    }

    private avoidOverlapping(newRegion: Region) {
        // Ensure regions don't overlap
        this.regions.forEach((reg) => {
            if (reg.id === newRegion.id) return
            if (newRegion.isOpenEnded) {
                if (reg.isOpenEnded) return
                if (reg.start < newRegion.start && newRegion.start < reg.end) {
                    throw new OverlapError(newRegion, reg)
                }
            } else {
                if (reg.isOpenEnded) {
                    if (newRegion.start < reg.start && newRegion.end > reg.start) {
                        throw new OverlapError(newRegion, reg)
                    }
                } else {
                    if (reg.start < newRegion.end && newRegion.start < reg.end) {
                        throw new OverlapError(newRegion, reg)
                    }
                }
            }
        })
    }

    private setNextRegion(newRegion: Region) {
        // Place this region in the doubly-linked list of regions
        if (!this.firstRegion) {
            this.firstRegion = newRegion
            return
        }

        let region = this.firstRegion;
        while (region.start < newRegion.start && region.nextRegion) {
            region = region.nextRegion
        }

        if (region.start > newRegion.start) {
            this.firstRegion = newRegion
            newRegion.nextRegion = region
            return
        }

        const nextRegion = region.nextRegion
        region.nextRegion = newRegion
        newRegion.prevRegion = region

        if (nextRegion) {
            newRegion.nextRegion = nextRegion
            nextRegion.prevRegion = newRegion
        }
        this.checkRegions();
    }

    public checkRegions() {
        // Ensure linked list integrity and print region contents
        let region = this.firstRegion
        while (region) {
            if (region.prevRegion && region.prevRegion.nextRegion !== region) {
                console.error(`Invalid linked list: ${region.prevRegion.nextRegion?.id} should be ${region.id}`);
            }
            if (region.nextRegion && region.nextRegion.prevRegion !== region) {
                console.error(`Invalid linked list: ${region.nextRegion.prevRegion?.id} should be ${region.id}`);
            }
            if (region.nextRegion && region.nextRegion.start < region.start) {
                console.error('Invalid linked list')
            }
            region = region.nextRegion
        }
    }

    private adjustScroll(region: Region) {
        const scrollContainer = this.wavesurfer?.getWrapper()?.parentElement
        if (!scrollContainer) return
        const { clientWidth, scrollWidth } = scrollContainer
        if (scrollWidth <= clientWidth) return
        const scrollBbox = scrollContainer.getBoundingClientRect()
        const bbox = region.element.getBoundingClientRect()
        const left = bbox.left - scrollBbox.left
        const right = bbox.right - scrollBbox.left
        if (left < 0) {
            scrollContainer.scrollLeft += left
        } else if (right > clientWidth) {
            scrollContainer.scrollLeft += right - clientWidth
        }
    }

    private virtualAppend(region: Region, container: HTMLElement, element: HTMLElement) {
        const renderIfVisible = () => {
            if (!this.wavesurfer) return
            const clientWidth = this.wavesurfer.getWidth()
            const scrollLeft = this.wavesurfer.getScroll()
            const scrollWidth = container.clientWidth
            const duration = this.wavesurfer.getDuration()
            const start = Math.round((region.start / duration) * scrollWidth)
            const width = Math.round(((region.end - region.start) / duration) * scrollWidth) || 1

            // Check if the region is between the scrollLeft and scrollLeft + clientWidth
            const isVisible = start + width > scrollLeft && start < scrollLeft + clientWidth

            if (isVisible) {
                container.appendChild(element)
            } else {
                element.remove()
            }
        }

        setTimeout(() => {
            if (!this.wavesurfer) return
            renderIfVisible()

            const unsubscribe = this.wavesurfer.on('scroll', renderIfVisible)
            this.subscriptions.push(region.once('remove', unsubscribe), unsubscribe)
        }, 0)
    }

    private saveRegion(region: Region) {
        this.virtualAppend(region, this.regionsContainer, region.element)
        this.avoidOverlapping(region)
        this.setNextRegion(region)
        this.regions.push(region)

        const regionSubscriptions = [
            region.on('update', (side) => {
                // Undefined side indicates that we are dragging not resizing
                if (!side) {
                    this.adjustScroll(region)
                }
                this.emit('region-update', region, side)
            }),

            region.on('update-end', () => {
                this.avoidOverlapping(region)
                this.emit('region-updated', region)
            }),

            region.on('play', () => {
                this.wavesurfer?.play()
                this.wavesurfer?.setTime(region.start)
            }),

            region.on('click', (e) => {
                this.emit('region-clicked', region, e)
            }),

            region.on('dblclick', (e) => {
                this.emit('region-double-clicked', region, e)
            }),

            // Remove the region from the list when it's removed
            region.once('remove', () => {
                regionSubscriptions.forEach((unsubscribe) => unsubscribe())
                this.regions = this.regions.filter((reg) => reg !== region)
                this.emit('region-removed', region)
            }),
        ]

        this.subscriptions.push(...regionSubscriptions)

        this.emit('region-created', region)
    }

    /** Create a region with given parameters */
    public addRegion(options: RegionParams): Region {
        if (!this.wavesurfer) {
            throw Error('WaveSurfer is not initialized')
        }

        const duration = this.wavesurfer.getDuration()
        const numberOfChannels = 5; // this.wavesurfer?.getDecodedData()?.numberOfChannels
        const region = new SingleRegion(options, duration, numberOfChannels)

        if (!duration) {
            this.subscriptions.push(
                this.wavesurfer.once('ready', (duration) => {
                    region._setTotalDuration(duration)
                    this.saveRegion(region)
                }),
            )
        } else {
            this.saveRegion(region)
        }

        return region
    }

    /** Remove all regions */
    public clearRegions() {
        this.regions.forEach((region) => region.remove())
        this.regions = []
        this.firstRegion = undefined;
    }

    /** Destroy the plugin and clean up */
    public destroy() {
        this.clearRegions()
        super.destroy()
        this.regionsContainer.remove()
    }
}

export default RegionsPlugin
export type Region = SingleRegion