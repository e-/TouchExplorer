import * as d3 from 'd3';
import { VisConstants as VC } from '../vis-constants';
import { translate, selectOrAppend } from '../../d3-utils/d3-utils';

type G = d3.Selection<d3.BaseType, {}, d3.BaseType, {}>;
type Extent = [[number, number], [number, number]];

export enum FlexBrushDirection {
    X,
    Y,
    XY
};

export enum FlexBrushMode {
    Point,
    Range
};

export class FlexBrush<Datum> {
    brushLine: d3.Selection<d3.BaseType, {}, d3.BaseType, {}>;
    g: G;
    extent: Extent;
    brush: d3.BrushBehavior<Datum>;
    handles: string[];
    handlers:{brush?: () => void} = {};
    snap: (number) => number;

    constructor(public direction:FlexBrushDirection = FlexBrushDirection.X,
        public mode = FlexBrushMode.Point) {
        this.setDirection(direction);
        this.setMode(mode);
    }

    setup(g:G) {
        this.g = selectOrAppend(g as any, 'g', '.brush-wrapper') as G;
    }

    setDirection(direction: FlexBrushDirection) {
        this.direction = direction;

        if(this.direction == FlexBrushDirection.X) {
            this.brush = d3.brushX();
            this.handles = ['w', 'e'];
        }
        else if(this.direction == FlexBrushDirection.Y) {
            this.brush = d3.brushY();
            this.handles = ['n', 's'];
        }
    }

    setMode(mode: FlexBrushMode) {
        this.mode = mode;
    }

    getHandle(dir:string, size = 10) {
        if(dir == 'w')
        {
            return "M-0.5,33.33A6,6 0 0 0 -6.5,39.33V60.66A6,6 0 0 0 -0.5,66.66ZM-2.5,41.33V58.66M-4.5,41.33V58.66";
        }
        else if(dir == 'e') {
            return "M0.5,33.33A6,6 0 0 1 6.5,39.33V60.66A6,6 0 0 1 0.5,66.66ZM2.5,41.33V58.66M4.5,41.33V58.66";
        }
        else if(dir == 'n') {
            return "M33.33,-0.5A6,6 0 0 1 39.33,-6.5H60.66A6,6 0 0 1 66.66,-0.5ZM41.33,-2.5H58.66M41.33,-4.5H58.66";
        }
        else if(dir == 's') {
            return "M33.33,0.5A6,6 0 0 0 39.33,6.5H60.66A6,6 0 0 0 66.66,0.5ZM41.33,2.5H58.66M41.33,4.5H58.66";
        }
    }
    /*
    <path d="M-0.5,33.33A6,6 0 0 0 -6.5,39.33V60.66A6,6 0 0 0 -0.5,66.66ZM-2.5,41.33V58.66M-4.5,41.33V58.66"></path>
    <path d="M0.5,33.33A6,6 0 0 1 6.5,39.33V60.66A6,6 0 0 1 0.5,66.66ZM2.5,41.33V58.66M4.5,41.33V58.66"></path>
    */

    render(extent) {
        this.brush.extent(extent);

        this.g.call(this.brush);

        this.g.select('rect.selection').style('stroke-width', 0);

        let handles = this.g.selectAll('.fb-handle')
            .data(this.handles);

        handles.exit().remove();

        handles = handles.enter().append('path')
            .style('fill', '#eee')
            .style('stroke', '#666')
            .attr('pointer-events', 'none')
            .attr('class', 'fb-handle')
            .merge(handles)
                .attr('d', this.getHandle)
        // ...

        let brushLine = selectOrAppend(this.g as any, 'line', '.brush-line')

        brushLine
            .style('stroke', 'black')
            .attr('pointer-events', 'none')

        this.brush
        .on('start', () => {
            handles.attr('display', 'inline')
        })
        .on('brush', () => {
            handles
            .attr('transform', (d, i) => {
                let x = 0, y = 0;
                let sel = d3.event.selection;
                if(d == 'w') x = sel[0];
                else if(d == 'e') x = sel[1];
                else if(d == 'n') y = sel[0];
                else if(d == 's') y = sel[1];

                return translate(x, y);
            })

            brushLine
                .attr(this.direction == FlexBrushDirection.X ? 'x1' : 'y1', () => {
                    return (d3.event.selection[0] + d3.event.selection[1]) / 2
                })
                .attr(this.direction == FlexBrushDirection.X ? 'x2' : 'y2', () => {
                    return (d3.event.selection[0] + d3.event.selection[1]) / 2
                })
                .attr(this.direction == FlexBrushDirection.X ? 'y1' : 'x1', () => {
                    return this.direction == FlexBrushDirection.X ? extent[0][1] : extent[0][0];
                })
                .attr(this.direction == FlexBrushDirection.X ? 'y2' : 'x2', () => {
                    return this.direction == FlexBrushDirection.X ? extent[1][1] : extent[1][0];
                })

            if(this.handlers.brush && d3.event.sourceEvent) {
                this.handlers.brush();
            }
        })
        .on('end', () => {
            if (!d3.event.sourceEvent) return;
            if(d3.event.selection == null)
                handles.attr('display', 'none')

            if(this.snap) {
                let center = (d3.event.selection[0] + d3.event.selection[1]) / 2;

                center = this.snap(center);
                console.log(center);
                this.move(center, true)
            }
        })

        if(this.mode == FlexBrushMode.Point) {
            this.g.selectAll('.handle').attr('display', 'none')
            this.g.selectAll('rect.overlay').attr('display', 'none');
        }
        else if(this.mode == FlexBrushMode.Range) {
            this.g.selectAll('.handle').attr('display', 'visible')
            this.g.selectAll('rect.overlay').attr('display', 'visible');
        }
    }

    move(range: number | [number, number], transition = false) {
        if(typeof range === 'number')
        {
            let point = range;
            if(transition)
                this.g.transition().call(this.brush.move as any, [range - VC.pointBrushSize, range + VC.pointBrushSize]);
            else
                this.g.call(this.brush.move, [range - VC.pointBrushSize, range + VC.pointBrushSize]);
        }
        else {
            this.g.call(this.brush.move, range);
        }
    }

    show() {
        this.g.attr('display', 'inline');
    }

    hide() {
        this.g.attr('display', 'none');
    }

    on(event, handler) {
        this.handlers[event] = handler;
    }
}
