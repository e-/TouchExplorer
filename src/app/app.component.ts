import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Dataset } from './data/dataset';
import { FieldTrait } from './data/field';
import { Engine } from './data/engine';

import { Query, AggregateQuery, EmptyQuery } from './data/query';
import { SumAccumulator, AccumulatedResponseDictionary } from './data/accumulator';
import { GroupBy } from './data/groupby';
import { MetadataEditorComponent } from './metadata-editor/metadata-editor.component';
import { ExplorationNode } from './exploration/exploration-node';
import { ExplorationLayout } from './exploration/exploration-layout';
import { ExplorationViewComponent } from './exploration/exploration-view.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
    title = 'app';
    @ViewChild('metadataEditor') metadataEditor: MetadataEditorComponent;
    @ViewChild('explorationView') explorationView: ExplorationViewComponent;

    dataset: Dataset;
    explorationRoot: ExplorationNode;
    explorationLayout: ExplorationLayout = new ExplorationLayout();
    engine: Engine;

    constructor() {

    }

    fieldSelected(parent: ExplorationNode, field: FieldTrait): Query {
        let query = parent.query.combine(field);
        let node = new ExplorationNode(parent, query);

        parent.addChild(node);

        this.explorationView.closeSelector();
        this.layout();

        this.engine.request(query);
        console.log(this.engine.queue.jobs);

        return query;
    }

    layout() {
        this.explorationLayout.layout(this.explorationRoot, this.explorationView.editable);
    }

    print(result: AccumulatedResponseDictionary) {
        for(const key in result) {
            const res = result[key];

            console.log(res.fieldValueList, res.accumulatedValue);
        }
    }

    ngOnInit() {
        this.engine = new Engine('./assets/movies.json');

        // let n1 = new ExplorationNode(this.explorationRoot, new EmptyQuery());
        // this.explorationRoot.addChild(n1);


        // let n2 = new ExplorationNode(this.explorationRoot, new EmptyQuery());
        // this.explorationRoot.addChild(n2);

        // n2.addChild(new ExplorationNode(n2, new EmptyQuery()));
        // n2.addChild(new ExplorationNode(n2, new EmptyQuery()));


        // let n3 = new ExplorationNode(this.explorationRoot, new EmptyQuery());
        // this.explorationRoot.addChild(n3);

        // n3.addChild(new ExplorationNode(n3, new EmptyQuery()));
        // n3.addChild(new ExplorationNode(n3, new EmptyQuery()));

        this.engine.load().then(dataset => {
            this.dataset = dataset;

            // this.metadataEditor.open();
            // run test codes


            // const query = new AggregateQuery(rating, new SumAccumulator(),
            //     new GroupBy([genre]), dataset);

            this.explorationRoot = new ExplorationNode(null, new EmptyQuery(dataset));
            this.layout();

            const genre = dataset.getFieldByName('Major_Genre');
            const query1 = this.fieldSelected(this.explorationRoot, genre);

            const rating = dataset.getFieldByName('Production_Budget');
            const query2 = this.fieldSelected(this.explorationRoot, rating);

            // server.request(query);

            this.engine.run();
            this.print(query1.result);

            this.engine.run();
            this.print(query1.result);

            this.engine.run();
            this.print(query1.result);

            // server.run();
            // console.log(JSON.stringify(query.result));

            // server.run();
            // console.log(JSON.stringify(query.result));
        })
    }

    toggleEditable() {
        this.explorationView.toggleEditable();
        this.layout();
    }

    run() {
        this.engine.run();
    }
}
