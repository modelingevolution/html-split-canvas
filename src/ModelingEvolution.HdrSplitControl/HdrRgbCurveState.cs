using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using ModelingEvolution.Drawing;

namespace ModelingEvolution.HdrSplitControl.Components;

/// <summary>
/// Manages the state of RGB HDR curves with separate channels
/// </summary>
public class HdrRgbCurveState
{
    private readonly Dictionary<string, HdrCurveState> _channels;
    private readonly Dictionary<string, float[]> _weights;

    public HdrRgbCurveState()
    {
        _channels = new Dictionary<string, HdrCurveState>
        {
            ["r"] = new HdrCurveState(),
            ["g"] = new HdrCurveState(),
            ["b"] = new HdrCurveState()
        };

        _weights = new Dictionary<string, float[]>
        {
            ["r"] = new float[256],
            ["g"] = new float[256],
            ["b"] = new float[256]
        };

        // Initialize default weights
        InitializeDefaults();
    }

    private void InitializeDefaults()
    {
        foreach (var channel in _channels.Values)
        {
            // Each channel starts with linear curve (0,0.5) to (255,0.5)
            // Use IDs 1 and 2 like the grayscale version
            channel.AddPoint(1, 0, 0.5f);
            channel.AddPoint(2, 255, 0.5f);
        }
        UpdateAllWeights();
    }

    public IReadOnlyDictionary<string, float[]> Weights => _weights;

    public void AddPoint(int pointId, float x, float y, string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            state.AddPoint(pointId, x, y);
            UpdateWeights(channel);
        }
    }

    public void RemovePoint(int pointId, string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            state.RemovePoint(pointId);
            UpdateWeights(channel);
        }
    }

    public void MovePoint(int pointId, float x, float y, string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            state.MovePoint(pointId, x, y);
            UpdateWeights(channel);
        }
    }

    public void MoveControlVector1(int pointId, float dx, float dy, string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            state.MoveControlVector1(pointId, dx, dy);
            UpdateWeights(channel);
        }
    }

    public void MoveControlVector2(int pointId, float dx, float dy, string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            state.MoveControlVector2(pointId, dx, dy);
            UpdateWeights(channel);
        }
    }

    private void UpdateWeights(string channel)
    {
        if (_channels.TryGetValue(channel, out var state))
        {
            _weights[channel] = state.Weights;

            // Validate weights
            Debug.Assert(_weights[channel].All(w => w >= 0f && w <= 1f),
                $"Channel {channel}: One or more weights are outside the valid range [0,1]");
        }
    }

    private void UpdateAllWeights()
    {
        foreach (var channel in _channels.Keys)
        {
            UpdateWeights(channel);
        }
    }

    public IReadOnlyDictionary<int, CurvePoint> GetChannelPoints(string channel)
    {
        return _channels.TryGetValue(channel, out var state)
            ? state.Points
            : new Dictionary<int, CurvePoint>();
    }
}