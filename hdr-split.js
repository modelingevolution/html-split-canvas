class HDRSplitCanvas {
    constructor(canvas, grayscaleBar, outputBar) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.grayscaleBar = grayscaleBar;
        this.grayscaleCtx = grayscaleBar.getContext('2d');
        this.outputBar = outputBar;
        this.outputCtx = outputBar ? outputBar.getContext('2d') : null;
        this.infoBox = document.getElementById('infoBox');
        this.aspectRatio = 2; // width/height ratio

        this.points = [];
        this.draggedPoint = null;
        this.hoveredPoint = null;
        this.selectedPoint = null;
        this.hoveredX = null;
        this.isEditing = false;
        this.weights = new Float32Array(256);

        this.padding = 50;

        this.initializePoints();
        this.setupEventListeners();
        this.resize();
        window.addEventListener('resize', this.resize.bind(this));

        // Setup inline editing after DOM is ready
        setTimeout(() => this.setupInlineEditing(), 0);
    }

    initializePoints() {
        this.points.push({
            x: 0,
            y: 0.5,
            c1: null,
            c2: { x: 10, y: 0.5 }
        });

        this.points.push({
            x: 255,
            y: 0.5,
            c1: { x: 245, y: 0.5 },
            c2: null
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
        this.renderOutputBar();
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
        for (let point of this.points) {
            const mainScreen = this.graphToScreen(point.x, point.y);
            if (this.distance(screenX, screenY, mainScreen.x, mainScreen.y) < threshold) {
                return { point, type: 'main' };
            }

            if (point.c1) {
                const c1Screen = this.graphToScreen(point.c1.x, point.c1.y);
                if (this.distance(screenX, screenY, c1Screen.x, c1Screen.y) < threshold) {
                    return { point, type: 'c1' };
                }
            }

            if (point.c2) {
                const c2Screen = this.graphToScreen(point.c2.x, point.c2.y);
                if (this.distance(screenX, screenY, c2Screen.x, c2Screen.y) < threshold) {
                    return { point, type: 'c2' };
                }
            }
        }
        return null;
    }

    distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    onMouseDown(e) {
        // Don't allow selection during editing
        if (this.isEditing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const found = this.findPointAt(x, y);

        if (found) {
            this.draggedPoint = found;
            this.selectedPoint = found.type === 'main' ? found.point : null;
            this.canvas.style.cursor = 'grabbing';
        } else {
            const graph = this.screenToGraph(x, y);
            const snappedX = this.snapToGrid(graph.x);

            const existingPoint = this.points.find(p => p.x === snappedX);
            if (!existingPoint && snappedX > 0 && snappedX < 255 && graph.y >= 0 && graph.y <= 1) {
                const newPoint = {
                    x: snappedX,
                    y: graph.y,
                    c1: { x: snappedX - 10, y: graph.y },
                    c2: { x: snappedX + 10, y: graph.y }
                };

                this.points.push(newPoint);
                this.points.sort((a, b) => a.x - b.x);
                this.render();
                this.calculateWeights();
            }
        }
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Calculate hovered grayscale value
        const graph = this.screenToGraph(x, y);
        if (graph.x >= 0 && graph.x <= 255) {
            const grayValue = Math.round(graph.x);
            this.hoveredX = grayValue;
            this.updateInfoBox(grayValue);
        } else {
            this.hoveredX = null;
            this.updateInfoBox(null);
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
                this.render();
                this.calculateWeights();
                this.renderGrayscaleBar();
                this.renderOutputBar();
            }
        } else {
            const found = this.findPointAt(x, y);
            if (found !== this.hoveredPoint ||
                (found && this.hoveredPoint && found.type !== this.hoveredPoint.type)) {
                this.hoveredPoint = found;
                this.canvas.style.cursor = found ? 'grab' : 'crosshair';
                this.render();
            }

            // Update grayscale bar to show indicator
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
            this.updateInfoBox(this.selectedPoint.x, true); // Show as editable

            // Trigger inline editing for the selected point's weight
            if (!this.isEditing) {
                const weightDisplay = document.getElementById('weightDisplay');
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
        if (found && found.type === 'main' && this.points.length > 2) {
            if (found.point.x !== 0 && found.point.x !== 255) {
                const index = this.points.indexOf(found.point);
                if (index > -1) {
                    this.points.splice(index, 1);
                    this.render();
                    this.calculateWeights();
                }
            }
        }
    }

    calculateWeights() {
        for (let i = 0; i < 256; i++) {
            this.weights[i] = this.getValueAtX(i);
        }
        console.log('Weights updated:', Array.from(this.weights));
        this.renderGrayscaleBar();
        this.renderOutputBar();
    }

    renderGrayscaleBar() {
        if (!this.grayscaleCtx) return;

        const width = this.width;
        const height = 40;

        this.grayscaleCtx.clearRect(0, 0, width, height);

        // Draw each grayscale value with its weight applied
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * width;
            const barWidth = Math.ceil(width / 255) + 1;

            // Original grayscale value (not affected by weight for preview)
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

        // Draw output colors based on weighted grayscale values
        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * width;
            const barWidth = Math.ceil(width / 255) + 1;

            // Calculate output grayscale value (input * weight)
            const outputValue = Math.round(i * this.weights[i]);

            const color = `rgb(${outputValue}, ${outputValue}, ${outputValue})`;
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
        const weightDisplay = document.getElementById('weightDisplay');

        // Check if elements exist
        if (!valueDisplay || !hexDisplay || !weightDisplay) {
            return;
        }

        if (grayValue !== null) {
            this.hoveredX = grayValue;
            const weight = this.weights[grayValue];
            const hex = grayValue.toString(16).padStart(2, '0').toUpperCase();

            valueDisplay.textContent = grayValue.toString().padStart(3, ' ');
            hexDisplay.textContent = `#${hex}${hex}${hex}`;
            weightDisplay.textContent = weight.toFixed(3);

            // Update input color box
            if (colorBox) {
                colorBox.style.backgroundColor = `rgb(${grayValue}, ${grayValue}, ${grayValue})`;
            }

            // Update output color box with weighted value
            if (outputColorBox) {
                const outputValue = Math.round(grayValue * weight);
                outputColorBox.style.backgroundColor = `rgb(${outputValue}, ${outputValue}, ${outputValue})`;
            }

            // Show editable state if requested and point is selected
            if (showEditable && this.selectedPoint && this.selectedPoint.x === grayValue) {
                weightDisplay.classList.add('editable');
                weightDisplay.style.color = '#00d4ff';
            } else {
                weightDisplay.classList.remove('editable');
                weightDisplay.style.color = '';
            }
        } else {
            this.hoveredX = null;
            valueDisplay.textContent = '--';
            hexDisplay.textContent = '--';
            weightDisplay.textContent = '--';

            // Reset color boxes
            if (colorBox) {
                colorBox.style.backgroundColor = '#000';
            }
            if (outputColorBox) {
                outputColorBox.style.backgroundColor = '#000';
            }

            weightDisplay.classList.remove('editable');
            weightDisplay.style.color = '';
        }
    }

    getValueAtX(x) {
        if (this.points.length === 0) return 0.5;
        if (x <= this.points[0].x) return Math.max(0, Math.min(1, this.points[0].y));
        if (x >= this.points[this.points.length - 1].x) return Math.max(0, Math.min(1, this.points[this.points.length - 1].y));

        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];

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
        if (this.points.length < 2) return;

        this.ctx.strokeStyle = '#00b4d8';
        this.ctx.lineWidth = 3;

        // Draw the curve by sampling points and clamping
        this.ctx.beginPath();

        for (let x = 0; x <= 255; x++) {
            const y = this.getValueAtX(x);
            const screen = this.graphToScreen(x, y);

            if (x === 0) {
                this.ctx.moveTo(screen.x, screen.y);
            } else {
                this.ctx.lineTo(screen.x, screen.y);
            }
        }

        this.ctx.stroke();
    }

    drawPoints() {
        for (let point of this.points) {
            const mainScreen = this.graphToScreen(point.x, point.y);
            const isHovered = this.hoveredPoint && this.hoveredPoint.point === point;

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
            this.ctx.fillStyle = mainHovered ? '#00f5ff' : '#00d4ff';
            this.ctx.beginPath();
            this.ctx.arc(mainScreen.x, mainScreen.y, mainHovered ? 7 : 6, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    setupInlineEditing() {
        const setupEditableField = (element) => {
            if (!element) return;

            element.addEventListener('click', () => {
                // Only allow editing if the element has the editable class
                if (!element.classList.contains('editable')) return;
                if (this.isEditing) return; // Don't allow multiple edits
                if (!this.selectedPoint) return;

                this.isEditing = true; // Set editing flag

                const currentValue = element.textContent.trim();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue;
                input.className = 'inline-edit';
                input.style.width = element.style.width || '60px';

                element.replaceWith(input);
                input.focus();
                input.select();

                let isApplied = false; // Prevent double application

                const applyValue = () => {
                    if (isApplied) return;
                    isApplied = true;

                    // Replace comma with dot for European number format
                    const normalizedValue = input.value.replace(',', '.');
                    const newWeight = parseFloat(normalizedValue);

                    if (!isNaN(newWeight) && newWeight >= 0 && newWeight <= 1 && this.selectedPoint) {
                        const oldY = this.selectedPoint.y;
                        const deltaY = newWeight - oldY;

                        this.selectedPoint.y = newWeight;

                        // Move control points with the main point
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
                    if (isApplied) return;
                    isApplied = true;

                    input.replaceWith(element);
                    this.updateInfoBox(this.hoveredX);
                    this.isEditing = false; // Clear editing flag
                };

                // Replace comma with dot as user types
                input.addEventListener('input', (e) => {
                    if (input.value.includes(',')) {
                        const cursorPos = input.selectionStart;
                        input.value = input.value.replace(',', '.');
                        input.setSelectionRange(cursorPos, cursorPos);
                    }
                });

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

        // Setup inline editing for weight display
        const weightDisplay = document.getElementById('weightDisplay');
        if (weightDisplay) setupEditableField(weightDisplay);
    }

    getWeights() {
        return this.weights;
    }

    // Export the current curve state as JSON
    getState() {
        return {
            version: '1.0',
            points: this.points.map(point => ({
                x: point.x,
                y: point.y,
                c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
                c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
            }))
        };
    }

    // Import curve state from JSON
    setState(state) {
        if (!state || !state.points || !Array.isArray(state.points)) {
            console.error('Invalid state format');
            return false;
        }

        // Validate points
        const validPoints = state.points.every(point =>
            typeof point.x === 'number' &&
            typeof point.y === 'number' &&
            point.x >= 0 && point.x <= 255 &&
            point.y >= 0 && point.y <= 1
        );

        if (!validPoints) {
            console.error('Invalid point data');
            return false;
        }

        // Clear current points and load new ones
        this.points = state.points.map(point => ({
            x: point.x,
            y: point.y,
            c1: point.c1 ? { x: point.c1.x, y: point.c1.y } : null,
            c2: point.c2 ? { x: point.c2.x, y: point.c2.y } : null
        }));

        // Sort points by x coordinate
        this.points.sort((a, b) => a.x - b.x);

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
    const hdrSplit = new HDRSplitCanvas(canvas, grayscaleBar, outputBar);

    window.hdrSplit = hdrSplit;

    // Save button functionality
    document.getElementById('saveBtn').addEventListener('click', () => {
        const json = hdrSplit.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `hdr-curve-${timestamp}.json`;

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

    // Log example usage
    console.log('HDR Split Canvas loaded!');
    console.log('Usage examples:');
    console.log('  Get current state: hdrSplit.getState()');
    console.log('  Export as JSON: hdrSplit.exportJSON()');
    console.log('  Save: localStorage.setItem("hdrCurve", hdrSplit.exportJSON())');
    console.log('  Load: hdrSplit.importJSON(localStorage.getItem("hdrCurve"))');
    console.log('  Set custom state: hdrSplit.setState({...})');
});