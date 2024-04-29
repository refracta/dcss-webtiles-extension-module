import {Chart, registerables} from 'https://cdn.skypack.dev/chart.js';

Chart.register(...registerables);

export default class LatencyIndicator {
    static name = 'LatencyIndicator';
    static version = '1.0';
    static dependencies = [];
    static measurementInterval = parseInt(localStorage.LI_INTERVAL || '30');

    constructor() {
        this.chart = null;
        this.lastSent = 'l';
        this.chartData = {
            labels: [], datasets: [{
                label: 'Latency',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                borderColor: 'rgba(255, 99, 132, 1)',
                data: [],
                fill: false,
            }]
        };
        this.isMeasuring = false;
        this.startTime = 0;
        this.measurementTimer = null;
    }

    onLoad() {
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message.after.push((data) => {
            if (data.msg === 'game_started') {
                this.initComponents();
            }
        });
        IOHook.handle_message.before.push((data) => this.measureLatency(data));
    }

    initComponents() {
        const container = document.getElementById('right_column');
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        // Initialize Chart
        this.chart = new Chart(ctx, {
            type: 'line', data: this.chartData, options: {
                scales: {
                    x: {
                        type: 'category', position: 'bottom'
                    }, y: {
                        beginAtZero: true
                    }
                }, animation: {
                    duration: 0
                }, maintainAspectRatio: true
            }
        });

        const startButton = document.createElement('button');
        startButton.textContent = 'Start Measurement';
        startButton.style.color = 'black';
        startButton.addEventListener('click', () => this.startMeasurement());

        const stopButton = document.createElement('button');
        stopButton.textContent = 'Stop Measurement';
        stopButton.style.color = 'black';
        stopButton.addEventListener('click', () => this.stopMeasurement());

        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Data';
        resetButton.style.color = 'black';
        resetButton.addEventListener('click', () => this.resetChartData());

        container.appendChild(startButton);
        container.appendChild(stopButton);
        container.appendChild(resetButton);
    }

    startMeasurement() {
        if (this.isMeasuring) return; // Prevent multiple intervals
        this.isMeasuring = true;
        this.measurementTimer = setInterval(() => this.sendInput(), LatencyIndicator.measurementInterval);
    }

    stopMeasurement() {
        if (!this.isMeasuring) return;
        clearInterval(this.measurementTimer);
        this.isMeasuring = false;
    }

    resetChartData() {
        this.chartData.labels = [];
        this.chartData.datasets.forEach((dataset) => dataset.data = []);
        this.chart.update();
    }

    sendInput() {
        let msg = {text: this.lastSent === 'h' ? 'l' : 'h', msg: 'input'};
        this.lastSent = msg.text;
        socket.send(JSON.stringify(msg));
        this.startTime = performance.now();
    }

    measureLatency(data) {
        if (!this.isMeasuring) return;
        let roundTripTime = performance.now() - this.startTime;
        let count = this.chartData.labels.length + 1;
        this.chartData.labels.push(`${count}t`);
        this.chartData.datasets[0].data.push(roundTripTime);

        if (this.chartData.labels.length > 1000) {
            this.chartData.labels = [];
            this.chartData.datasets.forEach((dataset) => dataset.data = []);
        }

        this.chart.update();
    }
}
