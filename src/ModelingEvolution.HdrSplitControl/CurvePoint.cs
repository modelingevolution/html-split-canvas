using System.Collections.Immutable;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using ModelingEvolution.Drawing;
using ModelingEvolution.JsonParsableConverter;
using VectorF = ModelingEvolution.Drawing.Vector<float>;
using PointF = ModelingEvolution.Drawing.Point<float>;
using BezierF = ModelingEvolution.Drawing.BezierCurve<float>;

namespace ModelingEvolution.HdrSplitControl;


/// <summary>
/// Represents a point on the HDR curve with Bezier control vectors
/// </summary>
public class CurvePoint
{
    public int Id { get; set; }
    public PointF Position { get; set; }

    /// <summary>
    /// Control vector 1 (left control, relative to Position)
    /// </summary>
    public VectorF? ControlVector1 { get; set; }

    /// <summary>
    /// Control vector 2 (right control, relative to Position)
    /// </summary>
    public VectorF? ControlVector2 { get; set; }

    public CurvePoint(int id, float x, float y)
    {
        Id = id;
        Position = new PointF(x, y);
    }

    /// <summary>
    /// Gets the absolute position of control point 1
    /// </summary>
    public PointF? GetControlPoint1() =>
        ControlVector1.HasValue ? Position + ControlVector1.Value : null;

    /// <summary>
    /// Gets the absolute position of control point 2
    /// </summary>
    public PointF? GetControlPoint2() =>
        ControlVector2.HasValue ? Position + ControlVector2.Value : null;
}

/// <summary>
/// Manages the curve state and calculates weights
/// </summary>
[JsonConverter(typeof(JsonParsableConverter<HdrCurveState>))]
public class HdrCurveState : IParsable<HdrCurveState>
{
    private readonly Dictionary<int, CurvePoint> _pointsById = new();
    private readonly SortedList<float, CurvePoint> _sortedPoints = new();
    private readonly float[] _weights = new float[256];
    private readonly Dictionary<(int, int), BezierF> _bezierCache = new();
    private bool _needsRecalculation = true;
    private int _baseId = 1;

    public void SetBase(int baseId)
    {
        _baseId = baseId;
        // The base ID is used to map between JavaScript IDs (starting from baseId)
        // and C# IDs when reloading from a Path
    }

    public void Clear()
    {
        _pointsById.Clear();
        _sortedPoints.Clear();
        InvalidateCache();
    }

    public IReadOnlyDictionary<int, CurvePoint> Points => _pointsById;
    public float[] Weights
    {
        get
        {
            if (_needsRecalculation)
            {
                CalculateWeights();
            }
            return _weights;
        }
    }

    public HdrCurveState()
    {
        // Initialize with default points
        AddPoint(1, 0, 0.5f);
        AddPoint(2, 255, 0.5f);
    }

    public void AddPoint(int id, float x, float y)
    {
        // Fail-fast validation
        // ID validation removed - JavaScript uses incrementing IDs starting from 1
        if (x < 0 || x > 255)
            throw new ArgumentOutOfRangeException(nameof(x), "X coordinate must be between 0 and 255");
        if (y < 0 || y > 1)
            throw new ArgumentOutOfRangeException(nameof(y), "Y coordinate must be between 0 and 1");

        // Remove existing point if it exists
        if (_pointsById.TryGetValue(id, out var existing))
        {
            _sortedPoints.Remove(existing.Position.X);
        }

        var point = new CurvePoint(id, x, y)
        {
            // Default control vectors - always initialize both for proper Bezier curves
            ControlVector1 = new VectorF(-10, 0),
            ControlVector2 = new VectorF(10, 0)
        };

        _pointsById[id] = point;

        // Handle duplicate X values by slightly offsetting
        while (_sortedPoints.ContainsKey(x))
        {
            x += 0.001f;
            point.Position = new PointF(x, y);
        }
        _sortedPoints[x] = point;

        InvalidateCache();
    }

    public override string ToString()
    {
        return Path<float>.FromSegments(this.GetBezierSegments().Select(x => x.Item2)).ToString();
    }

    public void RemovePoint(int id)
    {

        if (!_pointsById.TryGetValue(id, out var point))
            throw new InvalidOperationException($"Point with ID {id} does not exist");

        _pointsById.Remove(id);
        _sortedPoints.Remove(point.Position.X);
        InvalidateCache();
    }

    public void MovePoint(int id, float x, float y)
    {
        // Fail-fast validation
        if (x < 0 || x > 255)
            throw new ArgumentOutOfRangeException(nameof(x), "X coordinate must be between 0 and 255");
        if (y < 0 || y > 1)
            throw new ArgumentOutOfRangeException(nameof(y), "Y coordinate must be between 0 and 1");

        if (!_pointsById.TryGetValue(id, out var point))
            throw new InvalidOperationException($"Point with ID {id} does not exist");

        var oldX = point.Position.X;

        // Remove from sorted list at old position
        _sortedPoints.Remove(oldX);

        // Update position
        point.Position = new PointF(x, y);

        // Re-add to sorted list at new position
        // Handle duplicate X values
        while (_sortedPoints.ContainsKey(x))
        {
            x += 0.001f;
            point.Position = new PointF(x, y);
        }
        _sortedPoints[x] = point;

        InvalidateCache();
    }

    public void MoveControlVector1(int id, float dx, float dy)
    {
        if (float.IsNaN(dx) || float.IsInfinity(dx))
            throw new ArgumentException("Invalid dx value", nameof(dx));
        if (float.IsNaN(dy) || float.IsInfinity(dy))
            throw new ArgumentException("Invalid dy value", nameof(dy));

        if (!_pointsById.TryGetValue(id, out var point))
            throw new InvalidOperationException($"Point with ID {id} does not exist");

        point.ControlVector1 = new VectorF(dx, dy);
        InvalidateCache();
    }

    public void MoveControlVector2(int id, float dx, float dy)
    {
        if (float.IsNaN(dx) || float.IsInfinity(dx))
            throw new ArgumentException("Invalid dx value", nameof(dx));
        if (float.IsNaN(dy) || float.IsInfinity(dy))
            throw new ArgumentException("Invalid dy value", nameof(dy));

        if (!_pointsById.TryGetValue(id, out var point))
            throw new InvalidOperationException($"Point with ID {id} does not exist");

        point.ControlVector2 = new VectorF(dx, dy);
        InvalidateCache();
    }

    private void InvalidateCache()
    {
        _bezierCache.Clear();
        _needsRecalculation = true;
    }

    private void CalculateWeights()
    {
        if (_sortedPoints.Count == 0)
        {
            for (int i = 0; i < 256; i++)
                _weights[i] = 0.5f;
            _needsRecalculation = false;
            return;
        }

        var points = _sortedPoints.Values.ToArray();

        if (points.Length == 1)
        {
            // Single point - flat line at that Y value
            var y = points[0].Position.Y;
            for (int i = 0; i < 256; i++)
                _weights[i] = Math.Clamp(y, 0, 1);
            _needsRecalculation = false;
            return;
        }

        // Create Bezier curves for each adjacent pair of points
        foreach (var (key, bezier) in GetBezierSegments()) 
            _bezierCache.TryAdd(key, bezier);

        // Calculate weights using cached Bezier curves
        for (int x = 0; x < 256; x++)
        {
            _weights[x] = GetValueAtX(x, points);

            // Verify weight is within valid range
            Debug.Assert(_weights[x] >= 0f && _weights[x] <= 1f,
                $"Weight at index {x} is out of range: {_weights[x]}");
        }

        // Additional verification that all weights are valid
        Debug.Assert(_weights.All(w => w >= 0f && w <= 1f),
            "One or more weights are outside the valid range [0,1]");

        _needsRecalculation = false;
    }

    private ((int, int), BezierF) CreateBezierSegment(CurvePoint leftPoint, CurvePoint rightPoint)
    {
        var key = (leftPoint.Id, rightPoint.Id);
        var p0 = leftPoint.Position;
        var p3 = rightPoint.Position;

        // Use control vectors if available, otherwise create defaults
        var p1 = leftPoint.ControlVector2.HasValue
            ? leftPoint.Position + leftPoint.ControlVector2.Value
            : new PointF(p0.X + (p3.X - p0.X) * 0.33f, p0.Y);

        var p2 = rightPoint.ControlVector1.HasValue
            ? rightPoint.Position + rightPoint.ControlVector1.Value
            : new PointF(p0.X + (p3.X - p0.X) * 0.67f, p3.Y);

        var bezier = new BezierF(p0, p1, p2, p3);
        return (key, bezier);
    }

    public IEnumerable<((int, int), BezierF)> GetBezierSegments()
    {
        if (_sortedPoints.Count < 2)
            yield break;

        var points = _sortedPoints.Values.ToArray();

        for (int i = 0; i < points.Length - 1; i++)
        {
            yield return CreateBezierSegment(points[i], points[i + 1]);
        }
    }

    private float GetValueAtX(float x, CurvePoint[] sortedPoints)
    {
        if (sortedPoints.Length == 0)
            return 0.5f;

        // Binary search for the segment containing x
        int left = 0;
        int right = sortedPoints.Length - 1;

        // Check if x is outside the curve
        if (x <= sortedPoints[0].Position.X)
            return sortedPoints[0].Position.Y;
        if (x >= sortedPoints[right].Position.X)
            return sortedPoints[right].Position.Y;

        // Find segment using binary search
        while (left < right - 1)
        {
            int mid = (left + right) / 2;
            if (sortedPoints[mid].Position.X <= x)
                left = mid;
            else
                right = mid;
        }

        var leftPoint = sortedPoints[left];
        var rightPoint = sortedPoints[right];

        // Get cached Bezier curve
        var key = (leftPoint.Id, rightPoint.Id);
        if (!_bezierCache.TryGetValue(key, out var bezier))
        {
            // This shouldn't happen if CalculateWeights was called properly
            return 0.5f;
        }

        // Calculate t parameter for the given x
        float deltaX = rightPoint.Position.X - leftPoint.Position.X;
        if (deltaX == 0) return leftPoint.Position.Y;

        // For a Bezier curve, we need to find t such that bezier.Evaluate(t).X == x
        // We'll use binary search to find the correct t value
        float t = FindTForX(bezier, x);

        // Evaluate the Bezier curve at t
        var result = bezier.Evaluate(t);
        return Math.Clamp(result.Y, 0, 1);
    }

    private float FindTForX(BezierF bezier, float targetX)
    {
        // Binary search to find t such that bezier.Evaluate(t).X ≈ targetX
        float tMin = 0f;
        float tMax = 1f;
        float epsilon = 0.0001f;
        int maxIterations = 20;

        for (int i = 0; i < maxIterations; i++)
        {
            float t = (tMin + tMax) / 2f;
            var point = bezier.Evaluate(t);

            if (Math.Abs(point.X - targetX) < epsilon)
                return t;

            if (point.X < targetX)
                tMin = t;
            else
                tMax = t;
        }

        return (tMin + tMax) / 2f;
    }

    public static HdrCurveState Parse(string s, IFormatProvider? provider)
    {
        if (TryParse(s, provider, out var result))
        {
            return result;
        }
        throw new FormatException($"Unable to parse HdrCurveState from: '{s}'");
    }

    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, [MaybeNullWhen(false)] out HdrCurveState result)
    {
        result = null;
        int seq = 0;
        try
        {
            if (!Path<float>.TryParse(s, provider, out var path))
            {
                return false;
            }

            result = new HdrCurveState().Load(seq, path);
            return true;
        }
        catch
        {
            result = null;
            return false;
        }
    }

    public HdrCurveState Load(int seq, in Path<float> path)
    {
        this._pointsById.Clear();
        this._sortedPoints.Clear();
        // Track points we've already added
        var pointIdByPosition = new Dictionary<PointF, int>();

        foreach (var segment in path.Segments)
        {
            // Add or get start point
            if (!pointIdByPosition.TryGetValue(segment.Start, out var startId))
            {
                startId = seq++;
                this.AddPoint(startId, segment.Start.X, segment.Start.Y);
                pointIdByPosition[segment.Start] = startId;
            }

            // Add or get end point
            if (!pointIdByPosition.TryGetValue(segment.End, out var endId))
            {
                endId = seq++;
                this.AddPoint(endId, segment.End.X, segment.End.Y);
                pointIdByPosition[segment.End] = endId;
            }

            // Set control vectors for the points
            // Start point's ControlVector2 = C0 - Start (right control)
            var startPoint = this._pointsById[startId];
            startPoint.ControlVector2 = new VectorF(
                segment.C0.X - segment.Start.X,
                segment.C0.Y - segment.Start.Y
            );

            // End point's ControlVector1 = C1 - End (left control)
            var endPoint = this._pointsById[endId];
            endPoint.ControlVector1 = new VectorF(
                segment.C1.X - segment.End.X,
                segment.C1.Y - segment.End.Y
            );
        }

        return this;
    }

   
}