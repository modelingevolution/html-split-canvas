class HDRSplitCanvasRGB {
    constructor(canvas, grayscaleBar, outputBar) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.grayscaleBar = grayscaleBar;
        this.grayscaleCtx = grayscaleBar.getContext('2d');
        this.outputBar = outputBar;
        this.outputCtx = outputBar ? outputBar.getContext('2d') : null;
        this.infoBox = document.getElementById('infoBox');
        this.aspectRatio = 2; // width/height ratio

        // Separate points and weights for each channel
        this.channels = {
            r: { points: [], weights: new Float32Array(256), color: '#ff4444' },
            g: { points: [], weights: new Float32Array(256), color: '#44ff44' },
            b: { points: [], weights: new Float32Array(256), color: '#4488ff' }
        };

        this.draggedPoint = null;
        this.draggedChannel = null; // Track which channel is being dragged
        this.hoveredPoint = null;
        this.hoveredChannel = null; // Track which channel is hovered
        this.selectedPoint = null;
        this.selectedChannel = null; // Track which channel's point is selected
        this.isEditing = false; // Track if currently editing a value
        this.hoveredX = null;

        this.padding = 50;

        this.initializePoints();
        this.setupEventListeners();
        this.resize();
        window.addEventListener('resize', this.resize.bind(this));

        // Setup inline editing after DOM is ready
        setTimeout(() => this.setupInlineEditing(), 0);
    }

    initializePoints() {
        // Initialize points for each channel
        Object.keys(this.channels).forEach(channel => {
            this.channels[channel].points.push({
                x: 0,
                y: 0.5,
                c1: null,
                c2: { x: 10, y: 0.5 }
            });

            this.channels[channel].points.push({
                x: 255,
                y: 0.5,
                c1: { x: 245, y: 0.5 },
                c2: null
            });
        });
    }


    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseenter', this.onMouseEnter.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
    }

    resize() {
        const container = this.canvas.parentElement;
        const containerWidth = container.clientWidth - 40; // Account for padding

        this.width = containerWidth;
        this.height = containerWidth / this.aspectRatio;

        const dpr = window.devicePixelRatio || 1;

        // Resize main canvas
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';

        this.ctx.scale(dpr, dpr);

        // Resize grayscale bar
        this.grayscaleBar.width = this.width * dpr;
        this.grayscaleBar.height = 40 * dpr;
        this.grayscaleBar.style.width = this.width + 'px';
        this.grayscaleBar.style.height = '40px';

        this.grayscaleCtx.scale(dpr, dpr);

        // Resize output bar
        if (this.outputBar && this.outputCtx) {
            this.outputBar.width = this.width * dpr;
            this.outputBar.height = 20 * dpr;
            this.outputBar.style.width = this.width + 'px';
            this.outputBar.style.height = '20px';
            this.outputCtx.scale(dpr, dpr);
        }

        this.graphWidth = this.width - 2 * this.padding;
        this.graphHeight = this.height - 2 * this.padding;

        this.render();
        this.renderGrayscaleBar();
        this.calculateWeights();
        this.updateInfoBox(null);
    }

    screenToGraph(screenX, screenY) {
        const x = ((screenX - this.padding) / this.graphWidth) * 255;
        const y = 1 - ((screenY - this.padding) / this.graphHeight);
        return { x, y };
    }

    graphToScreen(graphX, graphY) {
        const x = this.padding + (graphX / 255) * this.graphWidth;
        const y = this.padding + (1 - graphY) * this.graphHeight;
        return { x, y };
    }

    snapToGrid(x) {
        return Math.round(Math.max(0, Math.min(255, x)));
    }

    findPointAt(screenX, screenY, threshold = 10) {
        // Check all channels and return the closest point
        for (let channel of ['r', 'g', 'b']) {
            const points = this.channels[channel].points;
            for (let point of points) {
                const mainScreen = this.graphToScreen(point.x, point.y);
                if (this.distance(screenX, screenY, mainScreen.x, mainScreen.y) < threshold) {
                    return { point, type: 'main', channel };
                }

                if (point.c1) {
                    const c1Screen = this.graphToScreen(point.c1.x, point.c1.y);
                    if (this.distance(screenX, screenY, c1Screen.x, c1Screen.y) < threshold) {
                        return { point, type: 'c1', channel };
                    }
                }

                if (point.c2) {
                    const c2Screen = this.graphToScreen(point.c2.x, point.c2.y);
                    if (this.distance(screenX, screenY, c2Screen.x, c2Screen.y) < threshold) {
                        return { point, type: 'c2', channel };
                    }
                }
            }
        }
        return null;
    }

    distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    onMouseDown(e) {
        // Don't allow any mouse actions while editing
        if (this.isEditing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const found = this.findPointAt(x, y);

        if (found) {
            // If clicking on a main point, select it
            if (found.type === 'main') {
                this.selectedPoint = found.point;
                this.selectedChannel = found.channel;
                // Update hoveredX to match the selected point
                this.hoveredX = this.selectedPoint.x;
                this.render(); // Re-render to show selection
                this.updateInfoBox(this.selectedPoint.x);
            }
            this.draggedPoint = found;
            this.draggedChannel = found.channel;
            this.canvas.style.cursor = 'grabbing';
        } else {
            const graph = this.screenToGraph(x, y);
            const snappedX = this.snapToGrid(graph.x);

            // Find which curve is closest to the click point
            let closestChannel = null;
            let closestDistance = Infinity;

            for (let channel of ['r', 'g', 'b']) {
                const curveY = this.getValueAtX(snappedX, channel);
                const curveScreen = this.graphToScreen(snappedX, curveY);
                const dist = Math.abs(y - curveScreen.y);
                if (dist < closestDistance) {
                    closestDistance = dist;
                    closestChannel = channel;
                }
            }

            if (closestChannel && closestDistance < 20) { // 20px threshold
                const points = this.channels[closestChannel].points;
                const existingPoint = points.find(p => p.x === snappedX);
                if (!existingPoint && snappedX > 0 && snappedX < 255 && graph.y >= 0 && graph.y <= 1) {
                    const newPoint = {
                        x: snappedX,
                        y: graph.y,
                        c1: { x: snappedX - 10, y: graph.y },
                        c2: { x: snappedX + 10, y: graph.y }
                    };

                    points.push(newPoint);
                    points.sort((a, b) => a.x - b.x);
                    this.render();
                    this.calculateWeights();
                }
            } else {
                // Clicked on empty space - deselect
                this.selectedPoint = null;
                this.selectedChannel = null;
                this.render(); // Re-render to remove selection highlight
                // Update info box based on current mouse position
                const graph = this.screenToGraph(x, y);
                if (graph.x >= 0 && graph.x <= 255) {
                    const grayValue = Math.round(graph.x);
                    this.hoveredX = grayValue;
                    this.updateInfoBox(grayValue);
                } else {
                    this.hoveredX = null;
                    this.updateInfoBox(null);
                }
            }
        }
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // If dragging, keep showing the selected point info
        if (this.draggedPoint) {
            // Keep showing the dragged point's info
            if (this.draggedPoint.type === 'main') {
                this.hoveredX = this.draggedPoint.point.x;
                this.updateInfoBox(this.draggedPoint.point.x);
            }
        } else {
            // Calculate hovered grayscale value only when not dragging
            const graph = this.screenToGraph(x, y);
            if (graph.x >= 0 && graph.x <= 255) {
                const grayValue = Math.round(graph.x);
                this.hoveredX = grayValue;
                this.updateInfoBox(grayValue);
            } else {
                // Outside graph bounds - show selected point if available
                if (this.selectedPoint) {
                    this.hoveredX = this.selectedPoint.x;
                    this.updateInfoBox(this.selectedPoint.x);
                } else {
                    this.hoveredX = null;
                    this.updateInfoBox(null);
                }
            }
        }

        if (this.draggedPoint) {
            const graph = this.screenToGraph(x, y);
            let needsUpdate = false;

            if (this.draggedPoint.type === 'main') {
                if (this.draggedPoint.point.x !== 0 && this.draggedPoint.point.x !== 255) {
                    const snappedX = this.snapToGrid(graph.x);
                    const deltaX = snappedX - this.draggedPoint.point.x;
                    const deltaY = Math.max(0, Math.min(1, graph.y)) - this.draggedPoint.point.y;

                    this.draggedPoint.point.x = snappedX;
                    this.draggedPoint.point.y = Math.max(0, Math.min(1, graph.y));
                    if (this.draggedPoint.point.c1) {
                        this.draggedPoint.point.c1.x += deltaX;
                        this.draggedPoint.point.c1.y += deltaY;
                    }
                    if (this.draggedPoint.point.c2) {
                        this.draggedPoint.point.c2.x += deltaX;
                        this.draggedPoint.point.c2.y += deltaY;
                    }
                    needsUpdate = true;
                } else {
                    const oldY = this.draggedPoint.point.y;
                    this.draggedPoint.point.y = Math.max(0, Math.min(1, graph.y));
                    const deltaY = this.draggedPoint.point.y - oldY;
                    if (deltaY !== 0) {
                        if (this.draggedPoint.point.c1) {
                            this.draggedPoint.point.c1.y += deltaY;
                        }
                        if (this.draggedPoint.point.c2) {
                            this.draggedPoint.point.c2.y += deltaY;
                        }
                        needsUpdate = true;
                    }
                }
            } else if (this.draggedPoint.type === 'c1') {
                this.draggedPoint.point.c1.x = graph.x;
                this.draggedPoint.point.c1.y = graph.y;
                needsUpdate = true;
            } else if (this.draggedPoint.type === 'c2') {
                this.draggedPoint.point.c2.x = graph.x;
                this.draggedPoint.point.c2.y = graph.y;
                needsUpdate = true;
            }

            if (needsUpdate) {
                // Update hoveredX if the point's x position changed
                if (this.draggedPoint.type === 'main') {
                    this.hoveredX = this.draggedPoint.point.x;
                    this.updateInfoBox(this.draggedPoint.point.x);
                }
                this.render();
                this.calculateWeights();
                this.renderGrayscaleBar();
                this.renderOutputBar();
            }
        } else {
            const found = this.findPointAt(x, y);
            if (found !== this.hoveredPoint ||
                (found && this.hoveredPoint && (found.type !== this.hoveredPoint.type || found.channel !== this.hoveredChannel))) {
                this.hoveredPoint = found;
                this.hoveredChannel = found ? found.channel : null;
                this.canvas.style.cursor = found ? 'grab' : 'crosshair';
                this.render();
            }

            // Update grayscale bar and output bar to show indicator
            this.renderGrayscaleBar();
            this.renderOutputBar();
        }
    }

    onMouseUp() {
        this.draggedPoint = null;
        this.canvas.style.cursor = this.hoveredPoint ? 'grab' : 'crosshair';
    }

    onMouseEnter() {
        // When entering canvas, remove editable state
        if (this.selectedPoint) {
            this.updateInfoBox(this.selectedPoint.x, false);
        }
    }

    onMouseLeave() {
        // When leaving canvas, show selected point info if available
        if (this.selectedPoint) {
            this.hoveredX = this.selectedPoint.x;
            this.updateInfoBox(this.selectedPoint.x, true); // Pass true to show editable state

            // Trigger inline editing for the selected point's weight
            if (!this.isEditing && this.selectedChannel) {
                const weightDisplay = this.selectedChannel === 'r' ? document.getElementById('rWeight') :
                                     this.selectedChannel === 'g' ? document.getElementById('gWeight') :
                                     document.getElementById('bWeight');
                if (weightDisplay && weightDisplay.classList.contains('editable')) {
                    weightDisplay.click(); // Trigger the inline edit
                }
            }
        } else {
            this.hoveredX = null;
            this.updateInfoBox(null);
        }
    }

    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const found = this.findPointAt(x, y);
        if (found && found.type === 'main') {
            const points = this.channels[found.channel].points;
            if (points.length > 2 && found.point.x !== 0 && found.point.x !== 255) {
                const index = points.indexOf(found.point);
                if (index > -1) {
                    points.splice(index, 1);
                    this.render();
                    this.calculateWeights();
                }
            }
        }
    }

    calculateWeights() {
        // Calculate weights for all channels
        Object.keys(this.channels).forEach(channel => {
            for (let i = 0; i < 256; i++) {
                this.channels[channel].weights[i] = this.getValueAtX(i, channel);
            }
        });
        console.log('Weights updated for all channels');
        this.renderGrayscaleBar();
        this.renderOutputBar();
    }

    renderGrayscaleBar() {
        if (!this.grayscaleCtx) return;

        const width = this.width;
        const height = 40;

        this.grayscaleCtx.clearRect(0, 0, width, height);

        // Draw full RGB gradient
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * width;
            const barWidth = Math.ceil(width / 255) + 1;

            const color = `rgb(${i}, ${i}, ${i})`;
            this.grayscaleCtx.fillStyle = color;
            this.grayscaleCtx.fillRect(x, 0, barWidth, height);
        }

        // Draw vertical indicator line if hovering
        if (this.hoveredX !== null) {
            const x = (this.hoveredX / 255) * width;
            this.grayscaleCtx.strokeStyle = '#888';
            this.grayscaleCtx.lineWidth = 1;
            this.grayscaleCtx.beginPath();
            this.grayscaleCtx.moveTo(x, 0);
            this.grayscaleCtx.lineTo(x, height);
            this.grayscaleCtx.stroke();
        }
    }

    renderOutputBar() {
        if (!this.outputCtx) return;

        const width = this.width;
        const height = 20;

        this.outputCtx.clearRect(0, 0, width, height);

        // Draw output colors based on weighted RGB values
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * width;
            const barWidth = Math.ceil(width / 255) + 1;

            // Calculate output RGB values
            const outputR = Math.round(i * this.channels.r.weights[i]);
            const outputG = Math.round(i * this.channels.g.weights[i]);
            const outputB = Math.round(i * this.channels.b.weights[i]);

            const color = `rgb(${outputR}, ${outputG}, ${outputB})`;
            this.outputCtx.fillStyle = color;
            this.outputCtx.fillRect(x, 0, barWidth, height);
        }

        // Draw vertical indicator line if hovering
        if (this.hoveredX !== null) {
            const x = (this.hoveredX / 255) * width;
            this.outputCtx.strokeStyle = '#888';
            this.outputCtx.lineWidth = 1;
            this.outputCtx.beginPath();
            this.outputCtx.moveTo(x, 0);
            this.outputCtx.lineTo(x, height);
            this.outputCtx.stroke();
        }
    }

    updateInfoBox(grayValue, showEditable = false) {
        const valueDisplay = document.getElementById('valueDisplay');
        const hexDisplay = document.getElementById('hexDisplay');
        const colorBox = document.getElementById('colorBox');
        const outputColorBox = document.getElementById('outputColorBox');
        const rWeightDisplay = document.getElementById('rWeight');
        const gWeightDisplay = document.getElementById('gWeight');
        const bWeightDisplay = document.getElementById('bWeight');

        // Check if elements exist
        if (!valueDisplay || !hexDisplay || !rWeightDisplay || !gWeightDisplay || !bWeightDisplay) {
            return;
        }

        if (grayValue !== null) {
            this.hoveredX = grayValue;
            const rWeight = this.channels.r.weights[grayValue];
            const gWeight = this.channels.g.weights[grayValue];
            const bWeight = this.channels.b.weights[grayValue];
            const hex = grayValue.toString(16).padStart(2, '0').toUpperCase();

            valueDisplay.textContent = grayValue.toString().padStart(3, ' ');
            hexDisplay.textContent = `#${hex}${hex}${hex}`;
            rWeightDisplay.textContent = rWeight.toFixed(3);
            gWeightDisplay.textContent = gWeight.toFixed(3);
            bWeightDisplay.textContent = bWeight.toFixed(3);

            // Update input color box
            if (colorBox) {
                colorBox.style.backgroundColor = `rgb(${grayValue}, ${grayValue}, ${grayValue})`;
            }

            // Update output color box with weighted RGB values
            if (outputColorBox) {
                const outputR = Math.round(grayValue * rWeight);
                const outputG = Math.round(grayValue * gWeight);
                const outputB = Math.round(grayValue * bWeight);
                outputColorBox.style.backgroundColor = `rgb(${outputR}, ${outputG}, ${outputB})`;
            }

            // Show colors and editable state based on context
            if (this.selectedPoint && this.selectedPoint.x === grayValue) {
                const weightDisplay = this.selectedChannel === 'r' ? rWeightDisplay :
                                     this.selectedChannel === 'g' ? gWeightDisplay : bWeightDisplay;
                weightDisplay.style.color = this.channels[this.selectedChannel].color;

                // Only mark as editable if explicitly requested (when mouse leaves canvas)
                if (showEditable) {
                    weightDisplay.classList.add('editable');
                } else {
                    rWeightDisplay.classList.remove('editable');
                    gWeightDisplay.classList.remove('editable');
                    bWeightDisplay.classList.remove('editable');
                }
            } else {
                rWeightDisplay.style.color = '';
                gWeightDisplay.style.color = '';
                bWeightDisplay.style.color = '';
                rWeightDisplay.classList.remove('editable');
                gWeightDisplay.classList.remove('editable');
                bWeightDisplay.classList.remove('editable');
            }
        } else {
            this.hoveredX = null;
            valueDisplay.textContent = '--';
            hexDisplay.textContent = '--';
            rWeightDisplay.textContent = '--';
            gWeightDisplay.textContent = '--';
            bWeightDisplay.textContent = '--';

            // Reset color boxes to black
            if (colorBox) {
                colorBox.style.backgroundColor = '#000';
            }
            if (outputColorBox) {
                outputColorBox.style.backgroundColor = '#000';
            }

            rWeightDisplay.classList.remove('editable');
            gWeightDisplay.classList.remove('editable');
            bWeightDisplay.classList.remove('editable');
        }
    }

    getValueAtX(x, channel) {
        const points = this.channels[channel].points;
        if (points.length === 0) return 0.5;
        if (x <= points[0].x) return Math.max(0, Math.min(1, points[0].y));
        if (x >= points[points.length - 1].x) return Math.max(0, Math.min(1, points[points.length - 1].y));

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            if (x >= p1.x && x <= p2.x) {
                const t = this.findTForX(p1, p2, x);
                const y = this.bezierY(p1, p2, t);
                return Math.max(0, Math.min(1, y));
            }
        }

        return 0.5;
    }

    findTForX(p1, p2, targetX) {
        let t = 0.5;
        let step = 0.25;

        for (let i = 0; i < 20; i++) {
            const x = this.bezierX(p1, p2, t);
            if (Math.abs(x - targetX) < 0.01) break;

            if (x < targetX) {
                t += step;
            } else {
                t -= step;
            }
            step *= 0.5;
        }

        return t;
    }

    bezierX(p1, p2, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        const c1x = p1.c2 ? p1.c2.x : p1.x;
        const c2x = p2.c1 ? p2.c1.x : p2.x;

        return mt3 * p1.x + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * p2.x;
    }

    bezierY(p1, p2, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        const c1y = p1.c2 ? p1.c2.y : p1.y;
        const c2y = p2.c1 ? p2.c1.y : p2.y;

        return mt3 * p1.y + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * p2.y;
    }

    render() {
        this.ctx.fillStyle = '#1e1e1e';
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.drawGrid();
        this.drawLegend();
        this.drawCurve();
        this.drawPoints();
        this.renderGrayscaleBar();
    }

    drawGrid() {
        this.ctx.strokeStyle = '#3a3a3a';
        this.ctx.lineWidth = 1;

        for (let i = 0; i <= 10; i++) {
            const x = this.padding + (i / 10) * this.graphWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, this.padding);
            this.ctx.lineTo(x, this.height - this.padding);
            this.ctx.stroke();
        }

        for (let i = 0; i <= 10; i++) {
            const y = this.padding + (i / 10) * this.graphHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(this.padding, y);
            this.ctx.lineTo(this.width - this.padding, y);
            this.ctx.stroke();
        }
    }

    drawLegend() {
        this.ctx.font = '11px Arial';
        this.ctx.fillStyle = '#aaa';
        this.ctx.textAlign = 'center';

        // X-axis labels (0-255)
        for (let i = 0; i <= 10; i++) {
            const value = Math.round((i / 10) * 255);
            const x = this.padding + (i / 10) * this.graphWidth;
            this.ctx.fillText(value.toString(), x, this.height - this.padding + 20);
        }

        // Y-axis labels (0.0-1.0)
        this.ctx.textAlign = 'right';
        for (let i = 0; i <= 10; i++) {
            const value = (1 - i / 10).toFixed(1);
            const y = this.padding + (i / 10) * this.graphHeight;
            this.ctx.fillText(value, this.padding - 8, y + 3);
        }

        // Axis labels
        this.ctx.textAlign = 'center';
        this.ctx.font = '12px Arial';
        this.ctx.fillText('Grayscale Value', this.width / 2, this.height - 5);

        this.ctx.save();
        this.ctx.translate(12, this.height / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillText('Weight', 0, 0);
        this.ctx.restore();
    }

    drawCurve() {
        // Always draw all three curves
        ['r', 'g', 'b'].forEach(channel => {
            this.drawChannelCurve(channel);
        });
    }

    drawChannelCurve(channel) {
        const points = this.channels[channel].points;
        if (points.length < 2) return;

        this.ctx.strokeStyle = this.channels[channel].color;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.8;

        // Draw the curve by sampling points and clamping
        this.ctx.beginPath();

        for (let x = 0; x <= 255; x++) {
            const y = this.getValueAtX(x, channel);
            const screen = this.graphToScreen(x, y);

            if (x === 0) {
                this.ctx.moveTo(screen.x, screen.y);
            } else {
                this.ctx.lineTo(screen.x, screen.y);
            }
        }

        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
    }

    drawPoints() {
        // Always draw points for all channels
        ['r', 'g', 'b'].forEach(channel => {
            this.drawChannelPoints(channel);
        });
    }

    drawChannelPoints(channel) {
        const points = this.channels[channel].points;
        const channelColor = this.channels[channel].color;

        for (let point of points) {
            const mainScreen = this.graphToScreen(point.x, point.y);
            const isHovered = this.hoveredPoint && this.hoveredPoint.point === point && this.hoveredChannel === channel;

            this.ctx.strokeStyle = '#666';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);

            if (point.c1) {
                const c1Screen = this.graphToScreen(point.c1.x, point.c1.y);
                this.ctx.beginPath();
                this.ctx.moveTo(c1Screen.x, c1Screen.y);
                this.ctx.lineTo(mainScreen.x, mainScreen.y);
                this.ctx.stroke();

                const c1Hovered = isHovered && this.hoveredPoint.type === 'c1';
                this.ctx.fillStyle = c1Hovered ? '#ffa500' : '#ff7b00';
                this.ctx.beginPath();
                this.ctx.arc(c1Screen.x, c1Screen.y, c1Hovered ? 5 : 4, 0, Math.PI * 2);
                this.ctx.fill();
            }

            if (point.c2) {
                const c2Screen = this.graphToScreen(point.c2.x, point.c2.y);
                this.ctx.beginPath();
                this.ctx.moveTo(mainScreen.x, mainScreen.y);
                this.ctx.lineTo(c2Screen.x, c2Screen.y);
                this.ctx.stroke();

                const c2Hovered = isHovered && this.hoveredPoint.type === 'c2';
                this.ctx.fillStyle = c2Hovered ? '#ffa500' : '#ff7b00';
                this.ctx.beginPath();
                this.ctx.arc(c2Screen.x, c2Screen.y, c2Hovered ? 5 : 4, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.setLineDash([]);

            const mainHovered = isHovered && this.hoveredPoint.type === 'main';
            const isSelected = this.selectedPoint === point && this.selectedChannel === channel;

            // Use channel color for main points
            const baseColor = channelColor;
            this.ctx.fillStyle = baseColor;

            // White outline for selected points, hover effect for hovered
            if (isSelected) {
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 3;
            } else if (mainHovered) {
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
            } else {
                this.ctx.strokeStyle = 'transparent';
                this.ctx.lineWidth = 0;
            }

            this.ctx.beginPath();
            this.ctx.arc(mainScreen.x, mainScreen.y, isSelected ? 8 : (mainHovered ? 7 : 6), 0, Math.PI * 2);
            this.ctx.fill();
            if (isSelected || mainHovered) this.ctx.stroke();
        }
    }

    getWeights() {
        return {
            r: this.channels.r.weights,
            g: this.channels.g.weights,
            b: this.channels.b.weights
        };
    }

    updateSelectedPointInfo() {
        // Update the info box to show if point is selected
        if (this.hoveredX !== null) {
            this.updateInfoBox(this.hoveredX);
        }
    }

    setupInlineEditing() {
        const setupEditableField = (element, isHex = false) => {
            element.addEventListener('click', (e) => {
                if (!this.selectedPoint || this.selectedPoint.x !== this.hoveredX) return;
                if (this.isEditing) return; // Don't allow multiple edits

                this.isEditing = true; // Set editing flag
                const currentValue = element.textContent;
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'inline-edit';
                input.value = currentValue;
                input.style.width = '45px';

                element.replaceWith(input);
                input.focus();
                input.select();

                let isApplied = false; // Prevent double application

                const applyValue = () => {
                    if (isApplied) return; // Already applied
                    isApplied = true;

                    let newWeight;

                    if (isHex) {
                        // Parse hex value
                        const hex = input.value.replace('#', '');
                        const grayValue = parseInt(hex.substr(0, 2), 16);
                        if (!isNaN(grayValue)) {
                            newWeight = grayValue / 255;
                        }
                    } else {
                        // Parse weight value directly, replacing comma with dot
                        const normalizedValue = input.value.replace(',', '.');
                        newWeight = parseFloat(normalizedValue);
                    }

                    if (!isNaN(newWeight) && newWeight >= 0 && newWeight <= 1) {
                        const deltaY = newWeight - this.selectedPoint.y;
                        this.selectedPoint.y = newWeight;

                        if (this.selectedPoint.c1) {
                            this.selectedPoint.c1.y += deltaY;
                        }
                        if (this.selectedPoint.c2) {
                            this.selectedPoint.c2.y += deltaY;
                        }

                        this.render();
                        this.calculateWeights();
                    }

                    input.replaceWith(element);
                    this.updateInfoBox(this.hoveredX);
                    this.isEditing = false; // Clear editing flag
                };

                const cancelEdit = () => {
                    if (isApplied) return; // Already handled
                    isApplied = true;

                    input.replaceWith(element);
                    this.updateInfoBox(this.hoveredX);
                    this.isEditing = false; // Clear editing flag
                };

                // Replace comma with dot as user types (for weight values only)
                if (!isHex) {
                    input.addEventListener('input', (e) => {
                        if (input.value.includes(',')) {
                            const cursorPos = input.selectionStart;
                            input.value = input.value.replace(',', '.');
                            input.setSelectionRange(cursorPos, cursorPos);
                        }
                    });
                }

                input.addEventListener('blur', applyValue);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur(); // Let blur handle the application
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    }
                });
            });
        };

        // Setup inline editing for weight displays
        const rWeight = document.getElementById('rWeight');
        const gWeight = document.getElementById('gWeight');
        const bWeight = document.getElementById('bWeight');

        if (rWeight) setupEditableField(rWeight);
        if (gWeight) setupEditableField(gWeight);
        if (bWeight) setupEditableField(bWeight);
    }

    // Export the current curve state as JSON
    getState() {
        return {
            version: '2.0',
            type: 'rgb',
            channels: {
                r: {
                    points: this.channels.r.points.map(point => ({
                        x: point.x,
                        y: point.y,
                        c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
                        c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
                    }))
                },
                g: {
                    points: this.channels.g.points.map(point => ({
                        x: point.x,
                        y: point.y,
                        c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
                        c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
                    }))
                },
                b: {
                    points: this.channels.b.points.map(point => ({
                        x: point.x,
                        y: point.y,
                        c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
                        c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
                    }))
                }
            }
        };
    }

    // Import curve state from JSON
    setState(state) {
        if (!state || !state.channels) {
            console.error('Invalid RGB state format');
            return false;
        }

        // Load points for each channel
        ['r', 'g', 'b'].forEach(channel => {
            if (state.channels[channel] && state.channels[channel].points) {
                const points = state.channels[channel].points;

                // Validate points
                const validPoints = points.every(point =>
                    typeof point.x === 'number' &&
                    typeof point.y === 'number' &&
                    point.x >= 0 && point.x <= 255 &&
                    point.y >= 0 && point.y <= 1
                );

                if (validPoints) {
                    this.channels[channel].points = points.map(point => ({
                        x: point.x,
                        y: point.y,
                        c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
                        c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
                    }));

                    // Sort points by x coordinate
                    this.channels[channel].points.sort((a, b) => a.x - b.x);
                }
            }
        });

        // Update display
        this.render();
        this.calculateWeights();

        return true;
    }

    // Export as JSON string
    exportJSON() {
        return JSON.stringify(this.getState(), null, 2);
    }

    // Import from JSON string
    importJSON(jsonString) {
        try {
            const state = JSON.parse(jsonString);
            return this.setState(state);
        } catch (e) {
            console.error('Failed to parse JSON:', e);
            return false;
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const grayscaleBar = document.getElementById('grayscaleBar');
    const outputBar = document.getElementById('outputBar');
    const hdrSplit = new HDRSplitCanvasRGB(canvas, grayscaleBar, outputBar);

    window.hdrSplit = hdrSplit;

    // Save button functionality
    document.getElementById('saveBtn').addEventListener('click', () => {
        const json = hdrSplit.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `hdr-curve-rgb-${timestamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`Saved curve to ${filename}`);
    });

    // Load button functionality
    document.getElementById('loadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    // File input handler
    document.getElementById('fileInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const success = hdrSplit.importJSON(content);

            if (success) {
                console.log(`Loaded curve from ${file.name}`);
            } else {
                alert('Failed to load curve file. Please check the file format.');
            }

            // Clear the input so the same file can be loaded again
            event.target.value = '';
        };

        reader.onerror = () => {
            alert('Error reading file');
            event.target.value = '';
        };

        reader.readAsText(file);
    });

    // Apply button for selected point values
    const applyBtn = document.getElementById('applyValues');
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            hdrSplit.applySelectedPointValues();
        });
    }

    // Enter key in input fields
    const xInput = document.getElementById('selectedX');
    const yInput = document.getElementById('selectedY');
    if (xInput && yInput) {
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                hdrSplit.applySelectedPointValues();
            }
        };
        xInput.addEventListener('keypress', handleEnter);
        yInput.addEventListener('keypress', handleEnter);
    }

    // Log example usage
    console.log('HDR Split Canvas RGB loaded!');
    console.log('All three RGB curves are displayed simultaneously.');
    console.log('Click near a curve to add points, drag to adjust.');
    console.log('Usage examples:');
    console.log('  Get RGB weights: hdrSplit.getWeights() // returns {r: Float32Array, g: Float32Array, b: Float32Array}');
    console.log('  Export as JSON: hdrSplit.exportJSON()');
    console.log('  Save: localStorage.setItem("hdrCurveRGB", hdrSplit.exportJSON())');
    console.log('  Load: hdrSplit.importJSON(localStorage.getItem("hdrCurveRGB"))');
});