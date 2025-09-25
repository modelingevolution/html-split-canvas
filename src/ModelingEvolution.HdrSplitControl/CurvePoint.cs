using System.Diagnostics;
using ModelingEvolution.Drawing;
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
public class HdrCurveState
{
    private readonly Dictionary<int, CurvePoint> _pointsById = new();
    private readonly SortedList<float, CurvePoint> _sortedPoints = new();
    private readonly float[] _weights = new float[256];
    private readonly Dictionary<(int, int), BezierF> _bezierCache = new();
    private bool _needsRecalculation = true;

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
        // ID validation removed - JavaScript generates large IDs using Date.now()
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
        // ID validation removed - JavaScript generates large IDs using Date.now()
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
        // ID validation removed - JavaScript generates large IDs using Date.now()
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
        // ID validation removed - JavaScript generates large IDs using Date.now()
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
        for (int i = 0; i < points.Length - 1; i++)
        {
            var key = (points[i].Id, points[i + 1].Id);
            if (!_bezierCache.ContainsKey(key))
            {
                var leftPoint = points[i];
                var rightPoint = points[i + 1];
                var p0 = leftPoint.Position;
                var p3 = rightPoint.Position;

                // Use control vectors if available, otherwise create defaults
                var p1 = leftPoint.ControlVector2.HasValue
                    ? leftPoint.Position + leftPoint.ControlVector2.Value
                    : new PointF(p0.X + (p3.X - p0.X) * 0.33f, p0.Y);

                var p2 = rightPoint.ControlVector1.HasValue
                    ? rightPoint.Position + rightPoint.ControlVector1.Value
                    : new PointF(p0.X + (p3.X - p0.X) * 0.67f, p3.Y);

                _bezierCache[key] = new BezierF(p0, p1, p2, p3);
            }
        }

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
}