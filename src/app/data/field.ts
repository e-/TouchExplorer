import { isNull, isNumber, isString } from "util";
import { NumericalGrouper, CategoricalGrouper, GroupIdType, NullGroupId } from './grouper';
import { QuantitativeUnit } from "./unit";

export enum DataType {
    String = "string",
    Integer = "integer",
    Float = "float"
}

export enum VlType {
    Quantitative = "quantitative",
    Ordinal = "ordinal",
    Nominal = "nominal",
    Key = "key"
}

export function getVlType(name: string) {
    switch(name.toLowerCase()) {
        case VlType.Quantitative.toLowerCase(): return VlType.Quantitative;
        case VlType.Ordinal.toLowerCase(): return VlType.Ordinal;
        case VlType.Nominal.toLowerCase(): return VlType.Nominal;
        case VlType.Key.toLowerCase(): return VlType.Key;
    }

    throw new Error(`unknown vltype: ${name}`);
}

export function getDataType(name: string) {
    switch(name.toLowerCase()) {
        case DataType.String.toLowerCase(): return DataType.String;
        case DataType.Integer.toLowerCase(): return DataType.Integer;
        case DataType.Float.toLowerCase(): return DataType.Float;
    }

    throw new Error(`unknown datatype: ${name}`);
}

export abstract class FieldTrait {
    dataType: DataType;
    vlType: VlType;
    nullable: boolean;
    order: number;

    constructor(public name: string) {

    }

    toJSON() {
        return {
            vlType: this.vlType,
            dataType: this.dataType,
            name: this.name
        }
    }

    abstract group(value: any): number;
    abstract ungroup(id: GroupIdType): null | string | [number, number];
    abstract ungroupString(id: GroupIdType): string;

    static fromJSON(json: any) {
        if(json.vlType === VlType.Ordinal)
            return new CategoricalField(json.name, json.dataType);
        else if(json.vlType == VlType.Key)
            return new KeyField(json.name, json.dataType);
        else if(json.vlType == VlType.Nominal)
            return new NominalField(json.name, json.dataType);
        else if(json.vlType == VlType.Quantitative)
            return new QuantitativeField(json.name, json.dataType,
                json.min, json.max, json.numBins);

        throw new Error(`Invalid field json: ${JSON.stringify(json)}`);
    }
}

export class QuantitativeField extends FieldTrait {
    vlType: VlType = VlType.Quantitative;
    grouper: NumericalGrouper;

    constructor(public name: string, public dataType: DataType,
        public initialMin: number, public initialMax: number, public numBins: number = 40,
        public nullable: boolean = false, public unit: QuantitativeUnit = null, public order: number = 0) {
        super(name);

        this.grouper = new NumericalGrouper(initialMin, initialMax, numBins);
    }

    group(value: any) {
        return this.grouper.group(value);
    }

    ungroup(id: GroupIdType) {
        return this.grouper.ungroup(id);
    }

    ungroupString(id: GroupIdType) {
        return this.grouper.ungroupString(id, '~s', this.unit);
    }

    get max() { return this.grouper.max; }
    get min() { return this.grouper.min; }

    toJSON() {
        return {
            vlType: this.vlType,
            dataType: this.dataType,
            name: this.name,
            start: this.grouper.min,
            end: this.grouper.max,
            numBins: this.grouper.numBins
        }
    }
}

export class CategoricalField extends FieldTrait {
    vlType: VlType = VlType.Ordinal;
    private grouper: CategoricalGrouper = new CategoricalGrouper();

    constructor(public name: string, public dataType: DataType,
        public nullable: boolean = false, public order: number = 0) {
        super(name);
    }

    group(value: any) {
        return this.grouper.group(value);
    }

    ungroup(id: GroupIdType) {
        return this.grouper.ungroup(id);
    }

    ungroupString(id: GroupIdType) {
        return this.grouper.ungroupString(id);
    }
}

export class OrdinalField extends CategoricalField {
    vlType: VlType = VlType.Ordinal;
}

export class NominalField extends CategoricalField {
    vlType: VlType = VlType.Nominal;
}

export class KeyField extends CategoricalField {
    vlType: VlType = VlType.Key;
}

/**
 * field & raw field value
 */
export class FieldValue {
    hash: string;

    constructor(public field: FieldTrait, public value: any) {
        if (field.nullable && isNull(value)) {
            // it is okay
        }
        else if (field.dataType == DataType.Integer && !Number.isInteger(value)) {
            throw `[field:${field.name}] the value ${value} is not an integer`;
        }
        else if (field.dataType == DataType.Float && !isNumber(value)) {
            throw `[field:${field.name}] the value ${value} is not a number`;
        }
        else if (field.dataType == DataType.String && !isString(value)) {
            throw `[field:${field.name}] the value ${value} is not a string`;
        }

        this.hash = `${field.name}:${value}`;
    }
}

export class FieldValueList {
    hash: string;

    constructor(public list: FieldValue[]) {
        this.hash = list.map(d => d.hash).join('_');
    }
}

export function guess(values: any[]): [DataType, VlType, boolean] {
    let dataType = guessDataType(values);
    let unique = {};

    values.forEach(value => unique[value] = true);

    let cardinality = Object.keys(unique).length;
    let vlType: VlType;

    if (dataType === DataType.Integer || dataType === DataType.Float)
        vlType = VlType.Quantitative;
    else if (cardinality <= 100)
        vlType = VlType.Nominal;
    else
        vlType = VlType.Key;

    return [dataType, vlType, unique[null as any] > 0];
}

export function guessDataType(values: any[]) {
    for (let i = 0; i < values.length; i++) {
        let value = values[i];
        let float = parseFloat(value);

        if (!isNull(value) && isNaN(float)) return DataType.String;
        if (!isNull(value) && !Number.isInteger(float)) return DataType.Float;
    }

    return DataType.Integer;
}
