using ModelingEvolution.HdrSplitControl;
using Xunit;
using Xunit.Abstractions;

namespace ModelingEvolution.HdrSplitControl.Tests;

public class HdrCurveStateTests
{
    private readonly ITestOutputHelper _output;

    public HdrCurveStateTests(ITestOutputHelper output)
    {
        _output = output;
    }
    [Fact]
    public void GetValueAtX_DefaultState_ReturnsInterpolatedValues()
    {
        // Arrange
        var state = new HdrCurveState();
        // Default state has points at (0, 0.5) and (255, 0.5)

        // Act & Assert
        // Should return 0.5 for all X values (straight line at y=0.5)
        Assert.Equal(0.5f, state.Weights[0], 0.001f);
        Assert.Equal(0.5f, state.Weights[127], 0.001f);
        Assert.Equal(0.5f, state.Weights[255], 0.001f);
    }

    [Fact]
    public void GetValueAtX_SinglePoint_ReturnsConstantValue()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(2); // Remove second default point
        state.MovePoint(1, 128, 0.75f); // Move first point to middle

        // Act & Assert
        // Should return 0.75 for all X values (constant at the single point's Y)
        Assert.Equal(0.75f, state.Weights[0], 0.001f);
        Assert.Equal(0.75f, state.Weights[128], 0.001f);
        Assert.Equal(0.75f, state.Weights[255], 0.001f);
    }

    [Fact]
    public void GetValueAtX_LinearInterpolation_ReturnsCorrectGradient()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(3, 0, 0.0f);
        state.AddPoint(4, 255, 1.0f);

        // Act & Assert
        // Should return linear interpolation from 0 to 1
        Assert.Equal(0.0f, state.Weights[0], 0.01f);
        Assert.Equal(0.25f, state.Weights[64], 0.1f); // Approximate due to Bezier
        Assert.Equal(0.5f, state.Weights[127], 0.1f);  // Approximate due to Bezier
        Assert.Equal(0.75f, state.Weights[191], 0.1f); // Approximate due to Bezier
        Assert.Equal(1.0f, state.Weights[255], 0.01f);
    }

    [Fact]
    public void GetValueAtX_OutsideBounds_ClampedBetweenZeroAndOne()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);

        // AddPoint now validates Y is between 0 and 1, so test that validation works
        Assert.Throws<ArgumentOutOfRangeException>(() => state.AddPoint(5, 50, 1.5f));
        Assert.Throws<ArgumentOutOfRangeException>(() => state.AddPoint(6, 200, -0.5f));

        // Add valid points at boundaries
        state.AddPoint(5, 50, 1.0f);  // Max valid Y
        state.AddPoint(6, 200, 0.0f); // Min valid Y

        // Act & Assert
        // Values should be clamped between 0 and 1
        foreach (var weight in state.Weights)
        {
            Assert.True(weight >= 0.0f && weight <= 1.0f,
                $"Weight {weight} is outside valid range [0,1]");
        }
    }

    [Fact]
    public void GetValueAtX_MultiplePoints_InterpolatesBetweenSegments()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(7, 0, 0.2f);
        state.AddPoint(8, 85, 0.8f);
        state.AddPoint(9, 170, 0.4f);
        state.AddPoint(10, 255, 0.6f);

        // Act & Assert
        // Check start and end points
        Assert.Equal(0.2f, state.Weights[0], 0.01f);
        Assert.Equal(0.6f, state.Weights[255], 0.01f);

        // Check that values are interpolated (not constant)
        var hasVariation = false;
        for (int i = 1; i < 255; i++)
        {
            if (Math.Abs(state.Weights[i] - state.Weights[i-1]) > 0.001f)
            {
                hasVariation = true;
                break;
            }
        }
        Assert.True(hasVariation, "Weights should have variation between points");
    }

    [Fact]
    public void GetValueAtX_BinarySearchCorrectness_FindsRightSegment()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);

        // Add many points to test binary search with larger gaps for clearer segments
        _output.WriteLine("Adding points:");
        state.AddPoint(100, 0, 0.2f);
        _output.WriteLine("Point 100: x=0, y=0.2");
        state.AddPoint(101, 50, 0.8f);
        _output.WriteLine("Point 101: x=50, y=0.8");
        state.AddPoint(102, 100, 0.3f);
        _output.WriteLine("Point 102: x=100, y=0.3");
        state.AddPoint(103, 150, 0.9f);
        _output.WriteLine("Point 103: x=150, y=0.9");
        state.AddPoint(104, 200, 0.4f);
        _output.WriteLine("Point 104: x=200, y=0.4");
        state.AddPoint(105, 255, 0.7f);
        _output.WriteLine("Point 105: x=255, y=0.7");

        // Act & Assert
        // Check that values at point positions match (within Bezier tolerance)
        _output.WriteLine("\nCalculated weights at key positions:");
        _output.WriteLine($"Weight[0] = {state.Weights[0]:F4} (expected 0.2)");
        _output.WriteLine($"Weight[50] = {state.Weights[50]:F4} (expected 0.8)");
        _output.WriteLine($"Weight[100] = {state.Weights[100]:F4} (expected 0.3)");
        _output.WriteLine($"Weight[150] = {state.Weights[150]:F4} (expected 0.9)");
        _output.WriteLine($"Weight[200] = {state.Weights[200]:F4} (expected 0.4)");
        _output.WriteLine($"Weight[255] = {state.Weights[255]:F4} (expected 0.7)");

        // Log some intermediate values to see the curve shape
        _output.WriteLine("\nSample of weights across the curve:");
        for (int i = 0; i < 256; i += 25)
        {
            _output.WriteLine($"Weight[{i}] = {state.Weights[i]:F4}");
        }

        Assert.Equal(0.2f, state.Weights[0], 0.05f);    // At first point
        Assert.Equal(0.8f, state.Weights[50], 0.15f);   // Near second point
        Assert.Equal(0.3f, state.Weights[100], 0.15f);  // Near third point
        Assert.Equal(0.9f, state.Weights[150], 0.15f);  // Near fourth point
        Assert.Equal(0.4f, state.Weights[200], 0.15f);  // Near fifth point
        Assert.Equal(0.7f, state.Weights[255], 0.05f);  // At last point

        // Verify interpolation happens between points
        var midpoint = state.Weights[25]; // Between first and second points
        _output.WriteLine($"\nMidpoint check: Weight[25] = {midpoint:F4}");
        Assert.True(midpoint > 0.2f && midpoint < 0.8f,
            $"Midpoint value {midpoint} should be between 0.2 and 0.8");
    }

    [Fact]
    public void GetValueAtX_BezierCurveSmoothness_ProducesSmootherCurve()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(11, 0, 0.0f);
        state.AddPoint(12, 127, 1.0f);
        state.AddPoint(13, 255, 0.0f);

        // Act
        var weights = state.Weights;

        // Assert - Check for smooth transitions (no sudden jumps)
        for (int i = 1; i < 255; i++)
        {
            var diff = Math.Abs(weights[i] - weights[i-1]);
            Assert.True(diff < 0.05f,
                $"Weight change too abrupt at index {i}: {diff}");
        }

        // Peak should be around the middle
        var maxIndex = Array.IndexOf(weights, weights.Max());
        Assert.True(Math.Abs(maxIndex - 127) < 20,
            $"Peak at {maxIndex} is too far from expected position 127");
    }

    [Fact]
    public void GetValueAtX_EdgeCases_HandlesExtremesCorrectly()
    {
        // Arrange
        var state = new HdrCurveState();

        // Test with points at exact boundaries
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(14, 0, 0.0f);
        state.AddPoint(15, 255, 1.0f);

        // Act & Assert
        Assert.Equal(0.0f, state.Weights[0], 0.001f);
        Assert.Equal(1.0f, state.Weights[255], 0.001f);

        // Test with no points - should use defaults
        state.RemovePoint(14);
        state.RemovePoint(15);

        // After removing all points, should return 0.5 (default)
        Assert.Equal(0.5f, state.Weights[0], 0.001f);
        Assert.Equal(0.5f, state.Weights[255], 0.001f);
    }

    [Fact]
    public void GetValueAtX_CacheInvalidation_RecalculatesAfterChange()
    {
        // Arrange
        var state = new HdrCurveState();

        // Initial state
        var initialWeight = state.Weights[127];

        // Act - Move a point
        state.MovePoint(1, 0, 0.9f);
        var afterMoveWeight = state.Weights[127];

        // Add a point
        state.AddPoint(20, 127, 0.1f);
        var afterAddWeight = state.Weights[127];

        // Assert - Weights should change after modifications
        Assert.NotEqual(initialWeight, afterMoveWeight);
        Assert.NotEqual(afterMoveWeight, afterAddWeight);
        Assert.Equal(0.1f, afterAddWeight, 0.05f); // Should be close to the added point's Y
    }

    [Fact]
    public void GetValueAtX_ControlVectors_AffectCurveShape()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(21, 0, 0.5f);
        state.AddPoint(22, 255, 0.5f);

        // Get initial weights (should be straight line)
        var straightLineWeights = state.Weights.ToArray();

        // Act - Add control vectors to create a curve
        state.MoveControlVector2(21, 50, 0.3f);  // Pull curve up
        state.MoveControlVector1(22, -50, -0.3f); // Pull curve down

        var curvedWeights = state.Weights.ToArray();

        // Assert - Weights should be different with control vectors
        var isDifferent = false;
        for (int i = 0; i < 256; i++)
        {
            if (Math.Abs(straightLineWeights[i] - curvedWeights[i]) > 0.01f)
            {
                isDifferent = true;
                break;
            }
        }

        Assert.True(isDifferent, "Control vectors should affect the curve shape");
    }

    [Fact]
    public void GetValueAtX_ExtremeControlVectors_WeightsClampedProperly()
    {
        // Arrange
        var state = new HdrCurveState();
        state.RemovePoint(1);
        state.RemovePoint(2);
        state.AddPoint(30, 0, 0.5f);
        state.AddPoint(31, 255, 0.5f);

        // Act - Add extreme control vectors that would push curve outside [0,1]
        state.MoveControlVector2(30, 50, 10f);  // Extreme upward pull
        state.MoveControlVector1(31, -50, -10f); // Extreme downward pull

        var weights = state.Weights;

        // Assert - All weights should still be within [0,1] range
        foreach (var weight in weights)
        {
            Assert.True(weight >= 0.0f, $"Weight {weight} is below 0");
            Assert.True(weight <= 1.0f, $"Weight {weight} is above 1");
        }

        // Also test negative extreme
        state.MoveControlVector2(30, 50, -10f);  // Extreme downward pull
        state.MoveControlVector1(31, -50, 10f); // Extreme upward pull

        weights = state.Weights;

        // Assert - All weights should still be within [0,1] range
        foreach (var weight in weights)
        {
            Assert.True(weight >= 0.0f, $"Weight {weight} is below 0 after negative extreme");
            Assert.True(weight <= 1.0f, $"Weight {weight} is above 1 after negative extreme");
        }
    }
}