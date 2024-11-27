import { Edge, EdgeMarker, Node } from '@xyflow/react';
import { ElkExtendedEdge, ElkNode } from 'elkjs';
import ELK from 'elkjs';
import { forEachNode, GraphNode, KubeObjectNode } from './graphModel';

type ElkNodeWithData = Omit<ElkNode, 'edges'> & {
  type: string;
  data: any;
  edges?: ElkEdgeWithData[];
};

type ElkEdgeWithData = ElkExtendedEdge & {
  type: string;
  data: any;
};

const elk = new ELK({
  defaultLayoutOptions: {},
});

const layoutOptions = {
  nodeSize: {
    width: 220,
    height: 70,
  },
};

const partitionLayers = [
  ['Deployment'],
  ['ReplicaSet', 'ServiceAccount', 'CronJob'],
  ['Job'],
  ['Pod', 'RoleBinding'],
  ['Service', 'NetworkPolicy', 'Role'],
];

/**
 * To increase readability of the graph we can sort nodes left-to-right
 * Where more 'owner' nodes like Deployment or ReplicaSet are on the left
 */
function getPartitionLayer(node: KubeObjectNode) {
  if (!('resource' in node.data)) return;
  const { kind } = node.data.resource;
  const partitionLayer = partitionLayers.findIndex(layer => layer.includes(kind));
  return partitionLayer > -1 ? partitionLayer : undefined;
}

/**
 * Prepare the node for the layout by converting it to the ELK node
 *
 * @param node - node
 * @param aspectRatio - aspect ratio of the container
 */
function convertToElkNode(node: GraphNode, aspectRatio: number): ElkNodeWithData {
  const isCollapsed = 'collapsed' in node.data && node.data.collapsed;

  const convertedEdges =
    'edges' in node.data
      ? (node.data.edges
          .map(edge => {
            // Make sure source and target exists
            let hasSource = false;
            let hasTarget = false;
            forEachNode(node, n => {
              if (n.id === edge.source) {
                hasSource = true;
              }
              if (n.id === edge.target) {
                hasTarget = true;
              }
            });

            if (!hasSource || !hasTarget) {
              return;
            }

            return {
              type: edge.type,
              id: edge.id,
              sources: [edge.source],
              targets: [edge.target],
              label: edge.label,
              labels: [{ text: edge.label, width: 70, height: 20 }],
              animated: edge.animated,
              hidden: false,
              data: edge.data,
            };
          })
          .filter(Boolean) as ElkEdgeWithData[])
      : [];

  const elkNode: ElkNodeWithData = {
    id: node.id,
    type: node.type,
    data: node.data,
  };

  if (node.type === 'kubeObject') {
    elkNode.layoutOptions = {
      'partitioning.partition': String(getPartitionLayer(node)),
    };
    elkNode.width = layoutOptions.nodeSize.width;
    elkNode.height = layoutOptions.nodeSize.height;
    return elkNode;
  }

  if (node.type === 'kubeGroup') {
    elkNode.layoutOptions = {
      'partitioning.activate': 'true',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.nodeSize.minimum': '(220.0,70.0)',
      'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
      'elk.algorithm': 'layered',
      'elk.spacing.nodeNode': isCollapsed ? '1' : '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'org.eclipse.elk.stress.desiredEdgeLength': isCollapsed ? '20' : '250',
      'org.eclipse.elk.stress.epsilon': '0.1',
      'elk.padding': '[left=16, top=16, right=16, bottom=16]',
    };
    elkNode.edges = convertedEdges;
    elkNode.children =
      'collapsed' in node.data && node.data.collapsed
        ? []
        : node.data.nodes.map(it => convertToElkNode(it, aspectRatio));
    return elkNode;
  }

  if (node.type === 'group') {
    elkNode.layoutOptions = {
      'elk.aspectRatio': String(aspectRatio),
      'elk.algorithm': 'rectpacking',
      'elk.rectpacking.widthApproximation.optimizationGoal': 'ASPECT_RATIO_DRIVEN',
      'elk.rectpacking.packing.compaction.rowHeightReevaluation': 'true',
      'elk.edgeRouting': 'SPLINES',
      'elk.spacing.nodeNode': '20',
      'elk.padding': '[left=24, top=24, right=24, bottom=24]',
    };
    elkNode.edges = convertedEdges;
    elkNode.children = node.data.nodes.map(it => convertToElkNode(it, aspectRatio));

    return elkNode;
  }
  return elkNode;
}

/**
 * Convert ELK graph back to react-flow graph
 */
function convertToReactFlowGraph(elkGraph: ElkNodeWithData) {
  const edges: Edge[] = [];
  const nodes: Node[] = [];

  const pushEdges = (node: ElkNodeWithData, parent?: ElkNodeWithData) => {
    node.edges?.forEach(edge => {
      edges.push({
        id: edge.id,
        source: edge.sources[0],
        target: edge.targets[0],
        type: edge.type ?? 'customEdge',
        selectable: false,
        focusable: false,
        hidden: false,
        markerEnd: {
          type: 'arrowclosed',
        } as EdgeMarker,
        data: {
          data: edge.data,
          sections: edge.sections,
          // @ts-ignore
          label: edge?.label,
          labels: edge.labels,
          parentOffset: {
            x: (node?.x ?? 0) + (parent?.x ?? 0),
            y: (node?.y ?? 0) + (parent?.y ?? 0),
          },
        },
      });
    });
  };

  const pushNode = (node: ElkNodeWithData, parent?: ElkNodeWithData) => {
    nodes.push({
      id: node.id,
      type: node.type,
      style: {
        width: node.width,
        height: node.height,
      },
      hidden: false,
      selectable: true,
      draggable: false,
      width: node.width,
      height: node.height,
      position: { x: node.x!, y: node.y! },
      data: node.data,
      parentId: parent?.id ?? undefined,
    });
  };

  const convertElkNode = (node: ElkNodeWithData, parent?: ElkNodeWithData) => {
    pushNode(node, parent);
    pushEdges(node, parent);

    node.children?.forEach(it => {
      convertElkNode(it as ElkNodeWithData, node);
    });
  };

  pushEdges(elkGraph);
  elkGraph.children!.forEach(node => {
    convertElkNode(node as ElkNodeWithData);
  });

  return { nodes, edges };
}

/**
 * Takes a graph and returns a graph with layout applied
 * Layout will set size and poisiton for all the elements
 *
 * @param graph - root node of the graph
 * @param aspectRatio - aspect ratio of the container
 * @returns
 */
export const applyGraphLayout = (graph: GraphNode, aspectRatio: number) => {
  const elkGraph = convertToElkNode(graph, aspectRatio);

  return elk
    .layout(elkGraph, {
      layoutOptions: {
        'elk.aspectRatio': String(aspectRatio),
      },
    })
    .then(elkGraph => convertToReactFlowGraph(elkGraph as ElkNodeWithData));
};