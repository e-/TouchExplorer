import * as d3 from 'd3';
import { QueryNode } from '../../data/query-node';
import { Constants as C } from '../../constants';
import * as util from '../../util';
import { AggregateQuery, Histogram2DQuery } from '../../data/query';
import { measure } from '../../d3-utils/measure';
import { translate, selectOrAppend } from '../../d3-utils/d3-utils';
import { FieldGroupedValue, QuantitativeField } from '../../data/field';
import { Renderer } from './renderer';
import { TooltipComponent } from '../../tooltip/tooltip.component';
import * as vsup from 'vsup';
import { VisComponent } from '../vis.component';
import { FittingTypes, ConstantTrait, PointValueConstant, RangeValueConstant, LinearRegressionConstant } from '../../safeguard/constant';
import { SafeguardTypes as SGT } from '../../safeguard/safeguard';
import { VariableTypes as VT, CombinedVariable, SingleVariable } from '../../safeguard/variable';
import { FlexBrush, FlexBrushDirection, FlexBrushMode } from './brush';
import { PunchcardTooltipComponent } from './punchcard-tooltip.component';
import { Gradient } from '../errorbars/gradient';
import { NullGroupId } from '../../data/grouper';
import { Datum } from '../../data/datum';

export class PunchcardRenderer implements Renderer {
    gradient = new Gradient();
    data: Datum[];
    xScale: d3.ScaleBand<string>;
    yScale: d3.ScaleBand<string>;
    xKeyIndex: number;
    yKeyIndex: number;
    matrixWidth: number;

    variable1: CombinedVariable;
    variable2: CombinedVariable;
    node: QueryNode;
    nativeSvg: SVGSVGElement;
    swatchXScale: d3.ScaleLinear<number, number>;
    flexBrush = new FlexBrush<Datum>(FlexBrushDirection.X, FlexBrushMode.Point, {
        yResize: 0.8
    });

    variableHighlight: d3.Selection<d3.BaseType, {}, null, undefined>;
    variableHighlight2: d3.Selection<d3.BaseType, {}, null, undefined>;
    eventRects: d3.Selection<d3.BaseType, Datum, d3.BaseType, {}>;
    swatch: d3.Selection<d3.BaseType, Datum, d3.BaseType, {}>;
    visG;
    interactionG;
    brushG;

    constructor(public vis: VisComponent, public tooltip: TooltipComponent) {
    }

    setup(node: QueryNode, nativeSvg: SVGSVGElement) {
        if ((node.query as AggregateQuery).groupBy.fields.length !== 2) {
            throw 'Punchcards can be used for 2 categories!';
        }

        let svg = d3.select(nativeSvg);

        this.gradient.setup(selectOrAppend(svg, 'defs'));
        this.visG = selectOrAppend(svg, 'g', 'vis');

        this.node = node;
        this.nativeSvg = nativeSvg;

        this.interactionG = selectOrAppend(svg, 'g', 'interaction');
        this.brushG = selectOrAppend(svg, 'g', 'brush-layer');
        this.flexBrush.setup(this.brushG);
        //this.distributionLine.setup(this.interactionG);
    }

    render(node: QueryNode, nativeSvg: SVGSVGElement) {
        let query = node.query as AggregateQuery;
        let visG = d3.select(nativeSvg).select('g.vis');

        let data = query.getVisibleData();
        this.data = data;

        let xKeys = {}, yKeys = {};
        let xKeyIndex = 0, yKeyIndex = 1;

        data.forEach(row => {
            xKeys[row.keys.list[0].hash] = row.keys.list[0];
            yKeys[row.keys.list[1].hash] = row.keys.list[1];
        });

        //if (d3.values(xKeys).length > d3.values(yKeys).length)
        //[yKeyIndex, xKeyIndex] = [xKeyIndex, yKeyIndex];

        this.xKeyIndex = xKeyIndex;
        this.yKeyIndex = yKeyIndex;

        let xValues: FieldGroupedValue[] = d3.values(xKeyIndex === 0 ? xKeys : yKeys);
        let yValues: FieldGroupedValue[] = d3.values(yKeyIndex === 1 ? yKeys : xKeys);

        if (this.node.query instanceof Histogram2DQuery) {
            let sortFunc = (a: FieldGroupedValue, b: FieldGroupedValue) => {
                let av = a.value(), bv = b.value();

                if(a.groupId === NullGroupId) return 1;
                if(b.groupId === NullGroupId) return -1;

                let ap = av ? av[0] as number : (a.field as QuantitativeField).max;
                let bp = bv ? bv[0] as number : (b.field as QuantitativeField).max;

                return ap - bp;
            }
            xValues.sort(sortFunc)
            yValues.sort(sortFunc);
            //yValues = yValues.reverse();
        }
        else {
            let weight = {}, count = {};
            data.forEach(row => {
                function accumulate(dict, key, value) {
                    if (!dict[key]) dict[key] = 0;
                    dict[key] += value;
                }

                accumulate(weight, row.keys.list[0].hash, row.ci3.center);
                accumulate(weight, row.keys.list[1].hash, row.ci3.center);
                accumulate(count, row.keys.list[0].hash, 1);
                accumulate(count, row.keys.list[1].hash, 1);
            })

            for (let key in weight) { weight[key] /= count[key]; }

            let sortFunc = (a: FieldGroupedValue, b: FieldGroupedValue) => {
                if(a.groupId === NullGroupId) return 1;
                if(b.groupId === NullGroupId) return -1;
                return weight[b.hash] - weight[a.hash];
            }

            xValues.sort(sortFunc);
            yValues.sort(sortFunc);
        }

        let [, yLongest,] = util.amax(yValues, d => d.valueString().length);
        const yLabelWidth = yLongest ? measure(yLongest.valueString()).width : 0;

        let [, xLongest,] = util.amax(xValues, d => d.valueString().length);
        const xLabelWidth = xLongest ? measure(xLongest.valueString()).width : 0;

        const xFieldLabelHeight = C.punchcard.label.x.height;
        const yFieldLabelWidth = C.punchcard.label.y.width;

        const header = 1.414 / 2 * (C.punchcard.columnWidth + xLabelWidth) + xFieldLabelHeight
        const height = C.punchcard.rowHeight * yValues.length + header * 2;

        const matrixWidth = xValues.length > 0 ?
            (yFieldLabelWidth + yLabelWidth + C.punchcard.columnWidth * (xValues.length - 1) + header) : 0;
        const width = matrixWidth + C.punchcard.legendSize * 1.2;

        this.matrixWidth = matrixWidth;

        d3.select(nativeSvg).attr('width', width).attr('height', height);

        const xScale = d3.scaleBand().domain(xValues.map(d => d.hash))
            .range([yFieldLabelWidth + yLabelWidth, matrixWidth - header]);

        const yScale = d3.scaleBand().domain(yValues.map(d => d.hash))
            .range([header, height - header]);

        this.xScale = xScale;
        this.yScale = yScale;

        // render top and bottom labels
        {
            // x labels
            selectOrAppend(visG, 'text', '.x.field.label.top')
                .text(query.groupBy.fields[this.xKeyIndex].name)
                .attr('transform', translate(matrixWidth / 2, 0))
                .style('text-anchor', 'middle')
                .attr('dy', '1.2em')
                .style('font-size', '.8rem')
                .style('font-style', 'italic')

            selectOrAppend(visG, 'text', '.x.field.label.bottom')
                .text(query.groupBy.fields[this.xKeyIndex].name)
                .attr('transform', translate(matrixWidth / 2, height - C.horizontalBars.axis.height))
                .style('text-anchor', 'middle')
                .attr('dy', '1.3em')
                .style('font-size', '.8rem')
                .style('font-style', 'italic')

            selectOrAppend(visG, 'text', '.y.field.label')
                .text(query.groupBy.fields[this.yKeyIndex].name)
                .attr('transform',
                    translate(0, height / 2) + 'rotate(-90)')
                .style('text-anchor', 'middle')
                .attr('dy', '1em')
                .style('font-size', '.8rem')
                .style('font-style', 'italic')
        }

        let enter: any;

        { // y labels
            const yLabels = visG
                .selectAll('text.label.y.data')
                .data(yValues, (d: FieldGroupedValue) => d.hash);

            enter = yLabels.enter().append('text').attr('class', 'label y data')
                .style('text-anchor', 'end')
                .attr('font-size', '.8rem')
                .attr('dy', '.8rem')

            yLabels.merge(enter)
                .attr('transform', (d) => translate(yFieldLabelWidth + yLabelWidth - C.padding, yScale(d.hash)))
                .text(d => d.valueString())

            yLabels.exit().remove();

        }

        { // x labels
            const xTopLabels = visG
                .selectAll('text.label.top.x.data')
                .data(xValues, (d: FieldGroupedValue) => d.hash);

            enter = xTopLabels.enter().append('text').attr('class', 'label x top data')
                .style('text-anchor', 'start')
                .attr('font-size', '.8rem')

            xTopLabels.merge(enter)
                .attr('transform', (d) =>
                    translate(xScale(d.hash) + xScale.bandwidth() / 2, header - C.padding) + 'rotate(-45)')
                .text(d => d.valueString())

            xTopLabels.exit().remove();

            const xBottomLabels = visG
                .selectAll('text.label.x.bottom.data')
                .data(xValues, (d: FieldGroupedValue) => d.hash);

            enter = xBottomLabels.enter().append('text').attr('class', 'label x bottom data')
                .style('text-anchor', 'start')
                .attr('font-size', '.8rem')

            xBottomLabels.merge(enter)
                .attr('transform', (d) =>
                    translate(xScale(d.hash) + xScale.bandwidth() / 2, height - header + yScale.bandwidth() / 2) + 'rotate(45)')
                .text(d => d.valueString())

            xBottomLabels.exit().remove();
        }

        const rects = visG
            .selectAll('rect.area')
            .data(data, (d: any) => d.id);

        enter = rects
            .enter().append('rect').attr('class', 'area')

        const xMin = (query as AggregateQuery).approximator.alwaysNonNegative ? 0 : d3.min(data, d => d.ci3.low);
        const xMax = d3.max(data, d => d.ci3.high);

        const niceTicks = d3.ticks(xMin, xMax, 8);
        const step = niceTicks[1] - niceTicks[0];
        const domainStart = (query as AggregateQuery).approximator.alwaysNonNegative ? Math.max(0, niceTicks[0] - step) : (niceTicks[0] - step);
        const domainEnd = niceTicks[niceTicks.length - 1] + step;

        if (node.domainStart > domainStart) node.domainStart = domainStart;
        if (node.domainEnd < domainEnd) node.domainEnd = domainEnd;

        let maxUncertainty = d3.max(data, d => d.ci3.high - d.ci3.center);

        if (node.maxUncertainty < maxUncertainty) node.maxUncertainty = maxUncertainty;

        maxUncertainty = node.maxUncertainty;

        let quant = vsup.quantization().branching(2).layers(4)
            .valueDomain([domainStart, domainEnd])
            .uncertaintyDomain([0, maxUncertainty]);

        let zScale = vsup.scale()
            .quantize(quant)
            .range(d3.interpolateViridis);

        rects.merge(enter)
            .attr('height', yScale.bandwidth())
            .attr('width', xScale.bandwidth())
            .attr('transform', (d) => {
                return translate(xScale(d.keys.list[xKeyIndex].hash), yScale(d.keys.list[yKeyIndex].hash))
            })
            .attr('fill', d => zScale(d.ci3.center, d.ci3.high - d.ci3.center));

        rects.exit().remove();

        const eventRects = visG
            .selectAll('rect.event.variable1')
            .data(data, (d: any) => d.id);

        enter = eventRects
            .enter().append('rect').attr('class', 'event variable1')

        eventRects.merge(enter)
            .attr('height', yScale.bandwidth())
            .attr('width', xScale.bandwidth())
            .attr('transform', (d) => {
                return translate(xScale(d.keys.list[xKeyIndex].hash), yScale(d.keys.list[yKeyIndex].hash))
            })
            .attr('fill', 'transparent')
            .style('cursor', 'pointer')
            .on('mouseenter', (d, i) => { this.showTooltip(d); })
            .on('mouseleave', (d, i) => { this.hideTooltip(); })
            .on('click', (d) => this.datumSelected(d))
            .on('contextmenu', (d) => this.datumSelected2(d))

        eventRects.exit().remove();

        this.eventRects = eventRects;

        // grid
        {
            const xLabelLines = visG.selectAll('line.label.x')
                .data(d3.range(xValues.length + 1));

            enter = xLabelLines.enter().append('line').attr('class', 'label x')
                .style('stroke', 'black')
                .style('opacity', 0.2);

            xLabelLines.merge(enter)
                .attr('x1', (d) => xScale.range()[0] + xScale.bandwidth() * d)
                .attr('x2', (d) => xScale.range()[0] + xScale.bandwidth() * d)
                .attr('y1', yScale.range()[0])
                .attr('y2', yScale.range()[1])

            xLabelLines.exit().remove();

            const yLabelLines = visG.selectAll('line.label.y')
                .data(d3.range(yValues.length + 1));

            enter = yLabelLines.enter().append('line').attr('class', 'label y')
                .style('stroke', 'black')
                .style('opacity', 0.2);

            yLabelLines.merge(enter)
                .attr('x1', xScale.range()[0])
                .attr('x2', xScale.range()[1])
                .attr('y1', (d) => yScale.range()[0] + yScale.bandwidth() * d)
                .attr('y2', (d) => yScale.range()[0] + yScale.bandwidth() * d)

            yLabelLines.exit().remove();
        }
        let legend = vsup.legend.arcmapLegend().scale(zScale).size(C.punchcard.legendSize);

        selectOrAppend(visG, 'g', '.z.legend').selectAll('*').remove();
        selectOrAppend(visG, 'g', '.z.legend')
            .attr('transform', translate(matrixWidth, 50))
            .append('g')
            .call(legend);

        this.updateSwatch();

        this.variableHighlight =
            selectOrAppend(visG, 'rect', '.variable1.highlighted')
                .attr('width', matrixWidth - header - yLabelWidth)
                .attr('height', height - header)
                .attr('transform', translate(yLabelWidth, header))
                .attr('display', 'none')
                .style('pointer-events', 'none')

        this.variableHighlight2 =
            selectOrAppend(visG, 'rect', '.variable2.highlighted')
                .attr('width', matrixWidth - header - yLabelWidth)
                .attr('height', height - header)
                .attr('transform', translate(yLabelWidth, header))
                .attr('display', 'none')
                .style('pointer-events', 'none')

        this.flexBrush.on('brush', (center) => {
            if (this.safeguardType === SGT.Point) {
                let constant = new PointValueConstant(this.swatchXScale.invert(center));
                this.constant = constant;
                this.vis.constantSelected.emit(constant);
            }
            else if (this.safeguardType === SGT.Range) {
                let sel = center as [number, number];
                let constant = new RangeValueConstant(this.swatchXScale.invert(sel[0]),
                    this.swatchXScale.invert(sel[1]));
                this.constant = constant;
                this.vis.constantSelected.emit(constant);
            }
        })

        if (this.variableType == VT.Value) {
            this.flexBrush.snap = null;

            this.flexBrush.setDirection(FlexBrushDirection.X);
            this.flexBrush.render([[matrixWidth, C.punchcard.legendSize * 1.5],
            [matrixWidth + C.punchcard.legendSize, C.punchcard.legendSize * 1.5 + C.punchcard.swatchHeight]]);
        }

        if (!this.constant) this.setDefaultConstantFromVariable();

        if ([SGT.Point, SGT.Range].includes(this.safeguardType) && this.constant)
            this.flexBrush.show();
        else
            this.flexBrush.hide();

        if (this.constant) {
            if (this.safeguardType === SGT.Point) {
                let center = this.swatchXScale((this.constant as PointValueConstant).value);
                this.flexBrush.move(center);
            }
            else if (this.safeguardType === SGT.Range) {
                let range = (this.constant as RangeValueConstant).range.map(this.swatchXScale) as [number, number];
                this.flexBrush.move(range);
            }
        }
    }

    highlight(highlighted: number) {
        this.variableHighlight.attr('display', 'none')
        this.variableHighlight2.attr('display', 'none')
        //this.constantHighlight.style('opacity', 0)

        if (highlighted == 1) {
            this.variableHighlight.attr('display', 'inline')
        }
        else if (highlighted == 2) {

        }
        else if (highlighted == 3) {
        }
        else if (highlighted == 4) {
            this.variableHighlight2.attr('display', 'inline')
        }
    }

    constant: ConstantTrait;

    safeguardType: SGT;
    setSafeguardType(st: SGT) {
        this.safeguardType = st;

        this.variable1 = null;
        this.variable2 = null;
        this.constant = null;
        this.updateHighlight();

        if (st == SGT.None) {
            this.eventRects.style('display', 'none');
        }
        else if (st == SGT.Point) {
            this.eventRects.style('display', 'inline');
            this.flexBrush.setMode(FlexBrushMode.Point);
        }
        else if (st === SGT.Range) {
            this.eventRects.style('display', 'inline');
            this.flexBrush.setMode(FlexBrushMode.SymmetricRange);
        }
        else if (st === SGT.Comparative) {
            this.eventRects.style('display', 'inline');
        }
    }

    variableType: VT;
    setVariableType(vt: VT) {
        this.variableType = vt;

        this.constant = null;
    }

    setFittingType(type: FittingTypes) {

    }

    updateHighlight() {

        this.eventRects
            .classed('stroke-highlighted', false)
            .filter((d) =>
                this.variable1 && this.variable1.hash === d.keys.hash ||
                this.variable2 && this.variable2.hash === d.keys.hash
            )
            .classed('stroke-highlighted', true)

        this.eventRects
            .classed('variable2', false)
            .filter((d) => this.variable2 && this.variable2.hash === d.keys.hash)
            .classed('variable2', true)
    }

    /* invoked when a constant is selected indirectly (by clicking on a category) */
    constantUserChanged(constant: ConstantTrait) {
        this.constant = constant;
        if (this.safeguardType === SGT.Point) {
            let center = this.swatchXScale((constant as PointValueConstant).value);
            this.flexBrush.show();
            this.flexBrush.move(center);
        }
        else if (this.safeguardType === SGT.Range) {
            let range = (constant as RangeValueConstant).range.map(this.swatchXScale) as [number, number];
            this.flexBrush.show();
            this.flexBrush.move(range);
        }
    }

    getDatum(variable: CombinedVariable): Datum {
        return this.data.find(d => d.id === variable.hash);
    }

    getRank(variable: CombinedVariable): number {
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i].id == variable.hash) return i + 1;
        }
        return 1;
    }

    datumSelected(d: Datum) {
        if (![SGT.Point, SGT.Range, SGT.Comparative].includes(this.safeguardType)) return;

        let variable = new CombinedVariable(
            new SingleVariable(d.keys.list[0]),
            new SingleVariable(d.keys.list[1]));
        if (this.variable2 && variable.hash === this.variable2.hash) return;
        this.variable1 = variable;

        this.updateSwatch();

        if (this.safeguardType === SGT.Range) {
            this.flexBrush.setCenter(this.swatchXScale(d.ci3.center));
        }
        this.updateHighlight();

        this.vis.variableSelected.emit({ variable: variable });
        this.setDefaultConstantFromVariable(true);
    }

    datumSelected2(d: Datum) {
        if (this.safeguardType != SGT.Comparative) return;
        d3.event.preventDefault();

        let variable = new CombinedVariable(
            new SingleVariable(d.keys.list[0]),
            new SingleVariable(d.keys.list[1]));

        if (this.variable1 && variable.hash === this.variable1.hash)
            return;
        this.variable2 = variable;
        this.updateHighlight();

        this.vis.variableSelected.emit({
            variable: variable,
            secondary: true
        });
    }

    setDefaultConstantFromVariable(removeCurrentConstant = false) {
        if (removeCurrentConstant) this.constant = null;
        if (this.constant) return;
        if (this.variable1) {
            if (this.safeguardType === SGT.Point) {
                let constant = new PointValueConstant(this.getDatum(this.variable1).ci3.center);
                this.vis.constantSelected.emit(constant);
                this.constantUserChanged(constant);
            }
            else if (this.safeguardType === SGT.Range) {
                let range = this.getDatum(this.variable1).ci3;
                let constant = new RangeValueConstant(range.low, range.high);

                if (range.low < 0) constant = new RangeValueConstant(0, range.high + range.low);
                this.vis.constantSelected.emit(constant);
                this.constantUserChanged(constant);
            }
        }
        else if (this.safeguardType === SGT.Distributive && this.node.query instanceof Histogram2DQuery) {
            let constant = LinearRegressionConstant.FitFromVisData(this.node.query.getVisibleData(), this.xKeyIndex, this.yKeyIndex);
            this.vis.constantSelected.emit(constant);
            this.constantUserChanged(constant);
        }
    }

    showTooltip(d: Datum) {
        const clientRect = this.nativeSvg.getBoundingClientRect();
        const parentRect = this.nativeSvg.parentElement.getBoundingClientRect();

        let data = {
            query: this.node.query,
            datum: d
        };

        this.tooltip.show(
            clientRect.left - parentRect.left + this.xScale(d.keys.list[this.xKeyIndex].hash) +
            this.xScale.bandwidth() / 2,
            clientRect.top - parentRect.top + this.yScale(d.keys.list[this.yKeyIndex].hash),
            PunchcardTooltipComponent,
            data
        );
    }

    hideTooltip() {
        this.tooltip.hide();
    }

    updateSwatch() {
        let swatch = selectOrAppend(this.visG, 'g', '.swatch')
            .attr('transform', translate(0, C.punchcard.legendSize * 1.5))

        swatch.style('display', 'none');
        if (!this.variable1) return;
        if (this.safeguardType !== SGT.Point && this.safeguardType !== SGT.Range) return;
        swatch.style('display', 'inline');

        let swatchXScale = d3.scaleLinear<number>().domain([
            this.node.domainStart,
            this.node.domainEnd]).range([
                this.matrixWidth,
                this.matrixWidth + C.punchcard.legendSize
            ])
        this.swatchXScale = swatchXScale;

        let datum = this.getDatum(this.variable1);

        selectOrAppend(swatch, 'g', '.top.main.axis')
            .call(d3.axisTop(swatchXScale))

        selectOrAppend(swatch, 'g', '.bottom.main.axis')
            .attr('transform', translate(0, C.punchcard.swatchHeight))
            .call(d3.axisBottom(swatchXScale))

        const leftBars = swatch
            .selectAll('rect.left.bar')
            .data([datum], (d: any) => d.id);

        leftBars.merge(
            leftBars.enter()
                .append('rect')
                .attr('class', 'left bar')
        )
            .attr('height', C.punchcard.swatchHeight)
            .attr('width', d => swatchXScale(d.ci3.center) - swatchXScale(d.ci3.low))
            .attr('transform', (d) => translate(swatchXScale(d.ci3.low), 0))
            .attr('fill', this.gradient.leftUrl())

        leftBars.exit().remove();

        const rightBars = swatch
            .selectAll('rect.right.bar')
            .data([datum], (d: any) => d.id);

        rightBars.merge(
            rightBars.enter()
                .append('rect')
                .attr('class', 'right bar')
        )
            .attr('height', C.punchcard.swatchHeight)
            .attr('width', d => swatchXScale(d.ci3.high) - swatchXScale(d.ci3.center))
            .attr('transform', (d) => translate(swatchXScale(d.ci3.center), 0))
            .attr('fill', this.gradient.rightUrl())

        rightBars.exit().remove();

        const centerLines = swatch
            .selectAll('line.center')
            .data([datum], (d: any) => d.id);

        centerLines.merge(
            centerLines.enter().append('line').attr('class', 'center')
        )
            .attr('x1', (d) => swatchXScale(d.ci3.center))
            .attr('y1', 0)
            .attr('x2', (d) => swatchXScale(d.ci3.center))
            .attr('y2', C.punchcard.swatchHeight)
            .style('stroke-width', 1)
            .style('stroke', 'black')
            .style('shape-rendering', 'crispEdges')

        centerLines.exit().remove();

        const majorTickLines = d3.axisTop(swatchXScale).tickSize(-C.punchcard.swatchHeight);

        selectOrAppend(swatch, 'g', '.sub.axis')
            .style('opacity', .2)
            .call(majorTickLines)
            .selectAll('text')
            .style('display', 'none')

    }
}
